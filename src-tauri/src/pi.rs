use crate::AppState;
use crate::models::{
    ApprovalDecision, PiRuntimeEvent, SendPromptPayload, SessionStatus, SidecarLineEvent,
    TimelineItem, ToolStatus, now_iso,
};
use anyhow::{Context, Result};
use base64::{Engine, engine::general_purpose::STANDARD};
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
};
use uuid::Uuid;

pub async fn launch_prompt_stream(
    app: AppHandle,
    shared: AppState,
    payload: SendPromptPayload,
) -> Result<()> {
    {
        let mut state = shared.state.lock().await;
        let workspace = state
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.id == payload.workspace_id)
            .context("workspace not found")?;
        let session = workspace
            .sessions
            .iter_mut()
            .find(|session| session.id == payload.session_id)
            .context("session not found")?;

        session.timeline.push(TimelineItem::UserMessage {
            id: Uuid::new_v4().to_string(),
            created_at: now_iso(),
            content: payload.prompt.clone(),
        });
        session.status = SessionStatus::Streaming;
        session.updated_at = now_iso();
        crate::storage::save(&app, &state)?;
    }

    let sidecar_path = std::env::var("PICODE_PI_SIDECAR")
        .ok()
        .unwrap_or_else(|| format!("{}/bin/pi-sidecar", env!("CARGO_MANIFEST_DIR")));

    let mut child = Command::new(sidecar_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .context("failed to spawn sidecar")?;

    let mut stdin = child.stdin.take().context("sidecar stdin unavailable")?;
    let stdout = child.stdout.take().context("sidecar stdout unavailable")?;
    let line = format!(
        "send\t{}\t{}\t{}\t{}\n",
        payload.session_id,
        "pi-core",
        "pi-4-pro",
        STANDARD.encode(payload.prompt),
    );
    stdin.write_all(line.as_bytes()).await?;
    drop(stdin);

    let workspace_id = payload.workspace_id.clone();
    let session_id = payload.session_id.clone();

    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        let mut assistant_content = String::new();

        while let Ok(Some(line)) = reader.next_line().await {
            if let Ok(parsed) = serde_json::from_str::<SidecarLineEvent>(&line) {
                match parsed.event_type.as_str() {
                    "token" => {
                        let delta = parsed.delta.unwrap_or_default();
                        assistant_content.push_str(&delta);
                        let _ = app.emit(
                            "pi://event",
                            PiRuntimeEvent::Token {
                                workspace_id: workspace_id.clone(),
                                session_id: session_id.clone(),
                                delta,
                            },
                        );
                    }
                    "status" => {
                        let _ = app.emit(
                            "pi://event",
                            PiRuntimeEvent::Status {
                                workspace_id: workspace_id.clone(),
                                session_id: session_id.clone(),
                                label: parsed.label.unwrap_or_else(|| "Status".to_string()),
                                detail: parsed.detail,
                            },
                        );
                    }
                    "tool-start" => {
                        if let Some(activity) = parsed.activity {
                            let _ = app.emit(
                                "pi://event",
                                PiRuntimeEvent::ToolStart {
                                    workspace_id: workspace_id.clone(),
                                    session_id: session_id.clone(),
                                    activity,
                                },
                            );
                        }
                    }
                    "tool-output" => {
                        let _ = app.emit(
                            "pi://event",
                            PiRuntimeEvent::ToolOutput {
                                workspace_id: workspace_id.clone(),
                                session_id: session_id.clone(),
                                activity_id: parsed.activity_id.unwrap_or_default(),
                                output: parsed.output.unwrap_or_default(),
                                status: parsed.status.unwrap_or(ToolStatus::Completed),
                            },
                        );
                    }
                    "approval-requested" => {
                        if let Some(approval) = parsed.approval {
                            let _ = app.emit(
                                "pi://event",
                                PiRuntimeEvent::ApprovalRequested {
                                    workspace_id: workspace_id.clone(),
                                    session_id: session_id.clone(),
                                    approval,
                                },
                            );
                        }
                    }
                    "done" => {
                        let content = parsed.content.unwrap_or_else(|| assistant_content.clone());
                        let _ = app.emit(
                            "pi://event",
                            PiRuntimeEvent::Done {
                                workspace_id: workspace_id.clone(),
                                session_id: session_id.clone(),
                                content: content.clone(),
                            },
                        );

                        let mut state = shared.state.lock().await;
                        if let Some(workspace) = state
                            .workspaces
                            .iter_mut()
                            .find(|workspace| workspace.id == workspace_id)
                        {
                            if let Some(session) = workspace
                                .sessions
                                .iter_mut()
                                .find(|session| session.id == session_id)
                            {
                                session.timeline.push(TimelineItem::AssistantMessage {
                                    id: Uuid::new_v4().to_string(),
                                    created_at: now_iso(),
                                    content,
                                    streaming: false,
                                });
                                session.status = SessionStatus::Idle;
                                session.updated_at = now_iso();
                            }
                        }
                        let _ = crate::storage::save(&app, &state);
                    }
                    "error" => {
                        let _ = app.emit(
                            "pi://event",
                            PiRuntimeEvent::Error {
                                workspace_id: workspace_id.clone(),
                                session_id: session_id.clone(),
                                message: parsed
                                    .detail
                                    .unwrap_or_else(|| "Sidecar failure".to_string()),
                            },
                        );
                    }
                    _ => {}
                }
            }
        }

        let _ = child.wait().await;
    });

    Ok(())
}

pub async fn resolve_approval_event(
    app: &AppHandle,
    workspace_id: &str,
    session_id: &str,
    approval_id: &str,
    decision: ApprovalDecision,
) {
    let summary = match decision {
        ApprovalDecision::Approved => "Pi can continue with the requested action.",
        ApprovalDecision::Rejected => "Pi was blocked from executing the requested action.",
    };

    let _ = app.emit(
        "pi://event",
        PiRuntimeEvent::ApprovalResolved {
            workspace_id: workspace_id.to_string(),
            session_id: session_id.to_string(),
            approval_id: approval_id.to_string(),
            decision,
            summary: summary.to_string(),
        },
    );
}
