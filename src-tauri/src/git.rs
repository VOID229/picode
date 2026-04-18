use crate::models::{DiffFile, GitSnapshot};
use std::process::Command;

pub fn snapshot(path: &str) -> GitSnapshot {
    let status_output = Command::new("git")
        .args(["-C", path, "status", "--short", "--branch"])
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
        .args(["-C", path, "diff", "--no-ext-diff", "--unified=3"])
        .output()
        .ok();
    let staged_output = Command::new("git")
        .args([
            "-C",
            path,
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
