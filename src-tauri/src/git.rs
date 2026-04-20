use crate::models::{DiffFile, GitSnapshot, expand_user_path};
use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UndoCheckpoint {
    pub workspace_id: String,
    pub session_id: String,
    pub user_message_id: String,
    pub branch: String,
    pub head_sha: String,
    pub working_tree_patch: String,
    pub staged_patch: String,
    pub untracked_files: Vec<UntrackedFileSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UntrackedFileSnapshot {
    pub path: String,
    pub content: Vec<u8>,
}

pub fn snapshot(path: &str) -> GitSnapshot {
    let path = expand_user_path(path);
    let status_output = Command::new("git")
        .args(["-C", &path, "status", "--short", "--branch"])
        .output();

    let Ok(status_output) = status_output else {
        return non_repo_snapshot();
    };

    if !status_output.status.success() {
        return non_repo_snapshot();
    }

    let status = String::from_utf8_lossy(&status_output.stdout);
    let mut lines = status.lines();
    let branch_line = lines.next().unwrap_or("## detached");
    let branch = branch_line.trim_start_matches("## ").to_string();
    let entries: Vec<&str> = lines.collect();

    let diff_output = Command::new("git")
        .args(["-C", &path, "diff", "--no-ext-diff", "--unified=3"])
        .output()
        .ok();
    let staged_output = Command::new("git")
        .args([
            "-C",
            &path,
            "diff",
            "--cached",
            "--no-ext-diff",
            "--unified=3",
        ])
        .output()
        .ok();

    let patch = diff_output
        .as_ref()
        .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
        .unwrap_or_default();
    let staged_patch = staged_output
        .as_ref()
        .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
        .unwrap_or_default();

    let files = entries
        .iter()
        .map(|entry| {
            let status_code = entry.chars().take(2).collect::<String>();
            let path = entry.get(3..).unwrap_or_default().to_string();
            DiffFile {
                path,
                status: classify_status(&status_code).to_string(),
                additions: patch.matches('\n').count(),
                deletions: staged_patch.matches('\n').count(),
                patch: if !patch.is_empty() {
                    patch.clone()
                } else {
                    staged_patch.clone()
                },
            }
        })
        .collect::<Vec<_>>();

    GitSnapshot {
        branch,
        summary: if entries.is_empty() {
            "Working tree clean".to_string()
        } else {
            format!("{} changed files", entries.len())
        },
        is_repo: true,
        dirty: !entries.is_empty(),
        staged_count: entries
            .iter()
            .filter(|entry| !entry.starts_with(" ") && !entry.starts_with("??"))
            .count(),
        unstaged_count: entries
            .iter()
            .filter(|entry| entry.starts_with(" M") || entry.starts_with("??"))
            .count(),
        files,
    }
}

fn non_repo_snapshot() -> GitSnapshot {
    GitSnapshot {
        branch: "not-a-repo".to_string(),
        summary: "No git repository detected".to_string(),
        is_repo: false,
        dirty: false,
        staged_count: 0,
        unstaged_count: 0,
        files: vec![],
    }
}

fn classify_status(code: &str) -> &'static str {
    match code.trim() {
        "A" | "AA" => "added",
        "D" | "DD" => "deleted",
        "R" | "RR" => "renamed",
        _ => "modified",
    }
}

pub fn capture_undo_checkpoint(
    workspace_id: &str,
    session_id: &str,
    user_message_id: &str,
    path: &str,
) -> Result<Option<UndoCheckpoint>> {
    let path = expand_user_path(path);
    if !snapshot(&path).is_repo {
        return Ok(None);
    }

    let branch = git_output_lines(&path, &["branch", "--show-current"])?
        .into_iter()
        .next()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "detached".to_string());
    let head_sha = git_output_lines(&path, &["rev-parse", "HEAD"])?
        .into_iter()
        .next()
        .context("failed to resolve current HEAD")?;

    Ok(Some(UndoCheckpoint {
        workspace_id: workspace_id.to_string(),
        session_id: session_id.to_string(),
        user_message_id: user_message_id.to_string(),
        branch,
        head_sha,
        working_tree_patch: git_output(
            &path,
            &["diff", "--binary", "--no-ext-diff", "--unified=3"],
        )?,
        staged_patch: git_output(
            &path,
            &[
                "diff",
                "--cached",
                "--binary",
                "--no-ext-diff",
                "--unified=3",
            ],
        )?,
        untracked_files: list_untracked_files(&path)?,
    }))
}

pub fn restore_undo_checkpoint(path: &str, checkpoint: &UndoCheckpoint) -> Result<()> {
    let path = expand_user_path(path);
    let current_head = git_output_lines(&path, &["rev-parse", "HEAD"])?
        .into_iter()
        .next()
        .context("failed to resolve current HEAD")?;

    if current_head != checkpoint.head_sha {
        return Err(anyhow!(
            "Undo is unavailable because HEAD moved from {} to {}.",
            checkpoint.head_sha,
            current_head
        ));
    }

    run_git(
        &path,
        &[
            "restore",
            "--staged",
            "--worktree",
            "--source=HEAD",
            "--",
            ".",
        ],
    )?;

    for file in list_current_untracked_paths(&path)? {
        let absolute = resolve_workspace_relative_path(Path::new(&path), &file)?;
        if absolute.is_file() {
            fs::remove_file(&absolute)
                .with_context(|| format!("failed to remove untracked file {}", file))?;
        } else if absolute.is_dir() {
            fs::remove_dir_all(&absolute)
                .with_context(|| format!("failed to remove untracked directory {}", file))?;
        }
    }

    apply_patch(&path, &checkpoint.staged_patch, true)?;
    apply_patch(&path, &checkpoint.working_tree_patch, false)?;

    for file in &checkpoint.untracked_files {
        let absolute = resolve_workspace_relative_path(Path::new(&path), &file.path)?;
        if let Some(parent) = absolute.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&absolute, &file.content)
            .with_context(|| format!("failed to restore untracked file {}", file.path))?;
    }

    Ok(())
}

fn git_output(path: &str, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .with_context(|| format!("failed to run git {}", args.join(" ")))?;

    if !output.status.success() {
        return Err(anyhow!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn git_output_lines(path: &str, args: &[&str]) -> Result<Vec<String>> {
    Ok(git_output(path, args)?
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect())
}

fn run_git(path: &str, args: &[&str]) -> Result<()> {
    let status = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .status()
        .with_context(|| format!("failed to run git {}", args.join(" ")))?;

    if !status.success() {
        return Err(anyhow!("git {} failed", args.join(" ")));
    }

    Ok(())
}

fn apply_patch(path: &str, patch: &str, cached: bool) -> Result<()> {
    if patch.trim().is_empty() {
        return Ok(());
    }

    let mut command = Command::new("git");
    command.arg("-C").arg(path).arg("apply").arg("--binary");
    if cached {
        command.arg("--cached");
    }
    command.stdin(Stdio::piped());
    command.stderr(Stdio::piped());

    let mut child = command.spawn().context("failed to spawn git apply")?;
    child
        .stdin
        .as_mut()
        .context("git apply stdin unavailable")?
        .write_all(patch.as_bytes())?;

    let output = child.wait_with_output()?;
    if !output.status.success() {
        return Err(anyhow!(
            "git apply failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

fn list_untracked_files(path: &str) -> Result<Vec<UntrackedFileSnapshot>> {
    let root = PathBuf::from(path);
    let paths = list_current_untracked_paths(path)?;
    paths
        .into_iter()
        .map(|relative| {
            let absolute = resolve_workspace_relative_path(&root, &relative)?;
            Ok(UntrackedFileSnapshot {
                path: relative,
                content: fs::read(&absolute).with_context(|| {
                    format!("failed to read untracked file {}", absolute.display())
                })?,
            })
        })
        .collect()
}

fn list_current_untracked_paths(path: &str) -> Result<Vec<String>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["ls-files", "--others", "--exclude-standard", "-z"])
        .output()
        .context("failed to list untracked files")?;

    if !output.status.success() {
        return Err(anyhow!(
            "git ls-files failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .map(|entry| String::from_utf8_lossy(entry).to_string())
        .collect())
}

fn resolve_workspace_relative_path(root: &Path, relative: &str) -> Result<PathBuf> {
    let path = Path::new(relative);
    if path.is_absolute() {
        return Err(anyhow!(
            "absolute paths are not allowed in undo checkpoints"
        ));
    }

    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(anyhow!(
            "parent-directory traversal is not allowed in undo checkpoints"
        ));
    }

    Ok(root.join(path))
}
