use crate::models::{
    DiffFile, GitAction, GitSnapshot, PreparedGitAction, RunGitActionResult, expand_user_path,
};
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

fn resolve_git_binary() -> String {
    if Command::new("git").arg("--version").output().map(|o| o.status.success()).unwrap_or(false) {
        return "git".to_string();
    }
    for candidate in ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"] {
        if Command::new(candidate).arg("--version").output().map(|o| o.status.success()).unwrap_or(false) {
            return candidate.to_string();
        }
    }
    "git".to_string()
}

pub fn snapshot(path: &str) -> GitSnapshot {
    let path = expand_user_path(path);
    let git_binary = resolve_git_binary();
    let status_output = Command::new(&git_binary)
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

    let diff_output = Command::new(&git_binary)
        .args(["-C", &path, "diff", "--no-ext-diff", "--unified=3"])
        .output()
        .ok();
    let staged_output = Command::new(&git_binary)
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

pub fn prepare_git_action(path: &str) -> Result<PreparedGitAction> {
    let path = expand_user_path(path);
    let snapshot = snapshot(&path);
    if !snapshot.is_repo {
        return Err(anyhow!("This workspace is not a git repository."));
    }

    let (additions, deletions) = diff_counts(&path, false).unwrap_or((0, 0));
    let has_remote = git_output(&path, &["remote"]).map_or(false, |value| {
        value.lines().any(|line| !line.trim().is_empty())
    });
    let gh_available = Command::new("gh")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    let has_github_remote = git_output(&path, &["remote", "-v"]).map_or(false, |value| {
        value
            .lines()
            .any(|line| line.contains("github.com") || line.contains("git@github.com:"))
    });

    let pr_unavailable_reason = if !gh_available {
        Some("GitHub CLI is not installed or unavailable on PATH.".to_string())
    } else if !has_github_remote {
        Some("No GitHub remote was found for this repository.".to_string())
    } else {
        None
    };

    Ok(PreparedGitAction {
        branch: current_branch(&path)?,
        file_count: snapshot.files.len(),
        additions,
        deletions,
        staged_count: snapshot.staged_count,
        unstaged_count: snapshot.unstaged_count,
        has_staged: snapshot.staged_count > 0,
        has_unstaged: snapshot.unstaged_count > 0,
        can_push: has_remote,
        can_create_pr: pr_unavailable_reason.is_none(),
        pr_unavailable_reason,
    })
}

pub fn initialize_repository(path: &str) -> Result<GitSnapshot> {
    let path = expand_user_path(path);
    if !snapshot(&path).is_repo {
        git_output(&path, &["init", "-b", "main"]).or_else(|_| git_output(&path, &["init"]))?;
    }

    ensure_repository_head(&path)?;

    Ok(snapshot(&path))
}

pub fn diff_for_message(path: &str, include_unstaged: bool) -> Result<String> {
    let path = expand_user_path(path);
    if include_unstaged {
        let diff = git_output(
            &path,
            &["diff", "HEAD", "--no-ext-diff", "--unified=3", "--stat"],
        )
        .or_else(|_| git_output(&path, &["diff", "--no-ext-diff", "--unified=3", "--stat"]))?;
        if !diff.trim().is_empty() {
            return Ok(limit_context(diff, 16_000));
        }
    }

    let staged = git_output(
        &path,
        &["diff", "--cached", "--no-ext-diff", "--unified=3", "--stat"],
    )?;
    Ok(limit_context(staged, 16_000))
}

pub fn recent_commit_context(path: &str) -> Result<String> {
    let path = expand_user_path(path);
    let branch = current_branch(&path).unwrap_or_else(|_| "unknown".to_string());
    let log = git_output(
        &path,
        &[
            "log",
            "--oneline",
            "--decorate=no",
            "--max-count=12",
            "@{upstream}..HEAD",
        ],
    )
    .or_else(|_| git_output(&path, &["log", "--oneline", "--max-count=12"]))?;
    let stat = git_output(&path, &["diff", "--stat", "@{upstream}...HEAD"]).unwrap_or_default();
    Ok(limit_context(
        format!("Branch: {branch}\n\nCommits:\n{log}\n\nDiff stat:\n{stat}"),
        16_000,
    ))
}

pub fn run_git_action(
    path: &str,
    action: GitAction,
    include_unstaged: bool,
    commit_message: Option<&str>,
    pr_title: Option<&str>,
    pr_body: Option<&str>,
    draft: bool,
) -> Result<RunGitActionResult> {
    let path = expand_user_path(path);
    let before = prepare_git_action(&path)?;
    let mut steps = Vec::new();
    let mut generated_message = commit_message
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let should_commit = matches!(
        action,
        GitAction::Commit | GitAction::CommitPush | GitAction::CreatePr
    ) && (before.has_staged || (include_unstaged && before.has_unstaged));

    if should_commit {
        if include_unstaged {
            run_git(&path, &["add", "-A"])?;
        }
        let message = generated_message
            .as_deref()
            .context("A commit message is required.")?;
        run_git(&path, &["commit", "-m", message])?;
        steps.push("committed changes".to_string());
    }

    if matches!(
        action,
        GitAction::CommitPush | GitAction::Push | GitAction::CreatePr
    ) {
        push_current_branch(&path)?;
        steps.push("pushed branch".to_string());
    }

    let mut pr_url = None;
    if matches!(action, GitAction::CreatePr) {
        let title = pr_title
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .context("A PR title is required.")?;
        let body = pr_body.map(str::trim).unwrap_or_default();
        pr_url = Some(create_pr(&path, title, body, draft)?);
        steps.push("created pull request".to_string());
    }

    if steps.is_empty() {
        steps.push("nothing to do".to_string());
    }

    Ok(RunGitActionResult {
        summary: steps.join(", "),
        generated_message: generated_message.take(),
        pr_url,
        git: snapshot(&path),
    })
}

pub fn commit_workspace_changes(path: &str, include_unstaged: bool, message: &str) -> Result<bool> {
    let path = expand_user_path(path);
    let before = prepare_git_action(&path)?;
    let should_commit = before.has_staged || (include_unstaged && before.has_unstaged);
    if !should_commit {
        return Ok(false);
    }
    if include_unstaged {
        run_git(&path, &["add", "-A"])?;
    }
    run_git(&path, &["commit", "-m", message])?;
    Ok(true)
}

pub fn push_workspace_branch(path: &str) -> Result<()> {
    let path = expand_user_path(path);
    push_current_branch(&path)
}

pub fn create_pull_request(path: &str, title: &str, body: &str, draft: bool) -> Result<String> {
    let path = expand_user_path(path);
    create_pr(&path, title, body, draft)
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

fn current_branch(path: &str) -> Result<String> {
    Ok(git_output_lines(path, &["branch", "--show-current"])?
        .into_iter()
        .next()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "detached".to_string()))
}

fn diff_counts(path: &str, cached: bool) -> Result<(usize, usize)> {
    let mut args = vec!["diff", "--numstat"];
    if cached {
        args.push("--cached");
    } else {
        args.push("HEAD");
    }
    let output = git_output(path, &args)?;
    let mut additions = 0;
    let mut deletions = 0;
    for line in output.lines() {
        let mut parts = line.split_whitespace();
        additions += parts
            .next()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        deletions += parts
            .next()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
    }
    if !cached {
        for file in list_untracked_files(path)? {
            additions += count_file_lines(&file.content);
        }
    }
    Ok((additions, deletions))
}

fn count_file_lines(content: &[u8]) -> usize {
    if content.is_empty() {
        return 0;
    }
    let newline_count = content.iter().filter(|byte| **byte == b'\n').count();
    if content.ends_with(b"\n") {
        newline_count
    } else {
        newline_count + 1
    }
}

fn limit_context(value: String, max_chars: usize) -> String {
    if value.len() <= max_chars {
        return value;
    }
    format!("{}...\n[truncated]", &value[..max_chars])
}

fn create_pr(path: &str, title: &str, body: &str, draft: bool) -> Result<String> {
    let mut command = Command::new("gh");
    command
        .current_dir(path)
        .arg("pr")
        .arg("create")
        .arg("--title")
        .arg(title)
        .arg("--body")
        .arg(body)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if draft {
        command.arg("--draft");
    }

    let output = command.output().context("failed to run gh pr create")?;
    if !output.status.success() {
        return Err(anyhow!(
            "gh pr create failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn push_current_branch(path: &str) -> Result<()> {
    if run_git(
        path,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .is_ok()
    {
        return run_git(path, &["push"]);
    }

    let branch = current_branch(path)?;
    run_git(path, &["push", "-u", "origin", &branch]).or_else(|_| run_git(path, &["push"]))
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
    ensure_repository_head(&path)?;

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
    let git_binary = resolve_git_binary();
    let output = Command::new(&git_binary)
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
    let git_binary = resolve_git_binary();
    let status = Command::new(&git_binary)
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

fn ensure_repository_head(path: &str) -> Result<()> {
    if git_output(path, &["rev-parse", "--verify", "HEAD"]).is_ok() {
        return Ok(());
    }

    run_git_with_identity(path, &["commit", "--allow-empty", "-m", "Initial commit"])
}

fn run_git_with_identity(path: &str, args: &[&str]) -> Result<()> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args([
            "-c",
            "user.name=picode",
            "-c",
            "user.email=picode@localhost",
        ])
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
