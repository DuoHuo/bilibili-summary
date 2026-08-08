use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{LazyLock, Mutex};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

const PROGRESS_EVENT: &str = "summary://progress";

/// 运行中外部进程注册表：run_external 传入 `id` 时登记，kill_external 据此终止。
/// 仅支持单进程级取消（每个 id 一个子进程），进程结束后由 run_external 移除。
static CHILDREN: LazyLock<Mutex<HashMap<String, std::sync::Arc<tokio::sync::Mutex<tokio::process::Child>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 目标三元组（用于 sidecar 命名），与 Tauri externalBin 约定一致。
fn target_triple() -> String {
    let arch = std::env::consts::ARCH;
    let os = std::env::consts::OS;
    match (arch, os) {
        ("x86_64", "macos") => "x86_64-apple-darwin",
        ("aarch64", "macos") => "aarch64-apple-darwin",
        ("x86_64", "windows") => "x86_64-pc-windows-msvc",
        ("aarch64", "windows") => "aarch64-pc-windows-msvc",
        ("x86_64", "linux") => "x86_64-unknown-linux-gnu",
        ("aarch64", "linux") => "aarch64-unknown-linux-gnu",
        (a, o) => return format!("{a}-{o}"),
    }
    .to_string()
}

fn find_in_path(program: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(program);
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(windows)]
        {
            let exe = dir.join(format!("{program}.exe"));
            if exe.is_file() {
                return Some(exe);
            }
        }
    }
    None
}

/// 解析外部二进制：sidecar 资源（非空） → PATH。
fn resolve_program(app: &AppHandle, program: &str) -> Result<PathBuf, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let sidecar = resource_dir
        .join("binaries")
        .join(format!("{program}-{}", target_triple()));
    // 0 字节占位文件视为无效，回退 PATH（开发期未放置真二进制）
    let sidecar_valid = sidecar
        .is_file()
        && sidecar.metadata().map(|m| m.len() > 0).unwrap_or(false);
    if sidecar_valid {
        return Ok(sidecar);
    }
    find_in_path(program).ok_or_else(|| format!("调用 {program} 失败，请确认已安装"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalRunResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunExternalRequest {
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    /// 进度事件阶段名（如 whisper / render）
    stage: Option<String>,
    /// 任务标识（run_id）：传入后登记进进程注册表，供 kill_external 终止；也随进度事件回传。
    id: Option<String>,
}

/// 通用子进程执行：sidecar/PATH 解析 + stdout/stderr 逐行进度事件。
#[tauri::command]
pub async fn run_external(
    app: AppHandle,
    req: RunExternalRequest,
) -> Result<ExternalRunResult, String> {
    let program_path = resolve_program(&app, &req.program)?;

    let mut command = Command::new(&program_path);
    command.args(&req.args);
    if let Some(cwd) = &req.cwd {
        command.current_dir(cwd);
    }
    if let Some(env) = &req.env {
        for (key, value) in env {
            command.env(key, value);
        }
    }
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    let child = command
        .spawn()
        .map_err(|e| format!("调用 {} 失败，请确认已安装: {e}", req.program))?;

    // 共享句柄：run_external 与 kill_external 通过同一把锁串行访问，避免双重 wait。
    let child_arc = std::sync::Arc::new(tokio::sync::Mutex::new(child));
    if let Some(id) = &req.id {
        CHILDREN.lock().unwrap().insert(id.clone(), child_arc.clone());
    }
    let run_id = req.id.clone().unwrap_or_default();

    let stage = req.stage.clone().unwrap_or_else(|| "external".to_string());
    let stage_stdout = stage.clone();

    let stdout = child_arc.lock().await.stdout.take().expect("stdout piped");
    let stderr = child_arc.lock().await.stderr.take().expect("stderr piped");
    let app_for_stdout = app.clone();
    let app_for_stderr = app.clone();
    let run_id_stdout = run_id.clone();
    let run_id_stderr = run_id.clone();
    let stdout_task = tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let mut collected = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => break,
                Ok(_) => {
                    let trimmed = line.trim_end();
                    if !trimmed.is_empty() {
                        let _ = app_for_stdout.emit(
                            PROGRESS_EVENT,
                            serde_json::json!({
                                "run_id": run_id_stdout,
                                "stage": stage_stdout,
                                "detail": trimmed
                            }),
                        );
                        collected.push_str(&line);
                    }
                }
                Err(_) => break,
            }
        }
        collected
    });
    let stderr_task = tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        let mut collected = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => break,
                Ok(_) => {
                    let trimmed = line.trim_end();
                    if !trimmed.is_empty() {
                        let _ = app_for_stderr.emit(
                            PROGRESS_EVENT,
                            serde_json::json!({
                                "run_id": run_id_stderr,
                                "stage": stage,
                                "detail": trimmed
                            }),
                        );
                        collected.push_str(&line);
                    }
                }
                Err(_) => break,
            }
        }
        collected
    });

    // 轮询等待退出：kill_external 可能已终止进程，try_wait 返回已退出状态而非双重 wait。
    let status = loop {
        if let Some(status) = child_arc.lock().await.try_wait().map_err(|e| format!("等待进程失败: {e}"))? {
            break status;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    };
    let stdout_text = stdout_task.await.unwrap_or_default();
    let stderr_text = stderr_task.await.unwrap_or_default();

    // 进程已退出，从注册表移除（若 kill_external 已移除则忽略）。
    if let Some(id) = &req.id {
        CHILDREN.lock().unwrap().remove(id);
    }

    Ok(ExternalRunResult {
        exit_code: status.code().unwrap_or(-1),
        stdout: stdout_text,
        stderr: stderr_text,
    })
}

/// 定位 / 下载 Whisper 模型到应用数据目录。
#[tauri::command]
pub async fn ensure_whisper_model(app: AppHandle) -> Result<String, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let model_dir = data_dir.join("models");
    std::fs::create_dir_all(&model_dir).map_err(|e| format!("创建模型目录失败: {e}"))?;
    let model_path = model_dir.join("ggml-base.bin");
    if model_path.exists() {
        return Ok(model_path.to_string_lossy().to_string());
    }

    let url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
    let response = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载 Whisper 模型失败: {e}"))?;
    if !response.status().is_success() {
        return Err("下载 Whisper 模型失败".to_string());
    }

    let mut file = tokio::fs::File::create(&model_path)
        .await
        .map_err(|e| format!("保存 Whisper 模型失败: {e}"))?;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读取 Whisper 模型失败: {e}"))?;
        file.write_all(&chunk).await.map_err(|e| format!("写入 Whisper 模型失败: {e}"))?;
    }
    file.flush().await.map_err(|e| format!("写入 Whisper 模型失败: {e}"))?;

    Ok(model_path.to_string_lossy().to_string())
}

/// 原生另存为对话框 + 写入内容。
#[tauri::command]
pub async fn save_file(app: AppHandle, suggested_name: String, content: String) -> Result<Option<String>, String> {
    let file_path = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(&suggested_name)
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Some(path) = file_path {
        let path_buf = path.into_path().map_err(|e| e.to_string())?;
        std::fs::write(&path_buf, content).map_err(|e| format!("写入文件失败: {e}"))?;
        Ok(Some(path_buf.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

/// 定位 / 创建产物目录（app data output/{run_id}）。
#[tauri::command]
pub async fn resolve_output_dir(app: AppHandle, run_id: String) -> Result<String, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?.join("output");
    let dir = base.join(&run_id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建产物目录失败: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

/// 写入文本文件（产物落盘 / cookies.txt）。
#[tauri::command]
pub async fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("写入文件失败: {e}"))
}

/// 读取文本文件（whisper-cli 的 JSON 输出）。
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {e}"))
}

/// 判断路径是否为文件（cookie 路径 / wav / mp4 存在性）。
#[tauri::command]
pub fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).is_file()
}

/// 终止运行中的外部进程（按 run_external 登记的任务 id）。
/// 从注册表移除并 kill；已结束/不存在时返回 false。
#[tauri::command]
pub async fn kill_external(id: String) -> Result<bool, String> {
    let child_arc = CHILDREN.lock().unwrap().remove(&id);
    let Some(child_arc) = child_arc else {
        return Ok(false)
    };
    let mut guard = child_arc.lock().await;
    let _ = guard.kill().await;
    Ok(true)
}

/// 确保目录存在（截图 images 子目录等）。
#[tauri::command]
pub fn create_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("创建目录失败: {e}"))
}

/// 递归删除目录（删除 session 产物用）。文件不存在视为成功。
#[tauri::command]
pub fn remove_dir(path: String) -> Result<(), String> {
    let dir = std::path::Path::new(&path);
    if !dir.exists() {
        return Ok(())
    }
    std::fs::remove_dir_all(dir).map_err(|e| format!("删除目录失败: {e}"))
}

#[cfg(test)]
mod remove_dir_tests {
    use super::remove_dir;
    use std::fs;

    /// 删除包含嵌套目录与文件的整个 session 目录。
    #[test]
    fn removes_nested_session_dir() {
        let dir = std::env::temp_dir().join(format!("rmdir-session-{}", std::process::id()));
        fs::create_dir_all(dir.join("images")).unwrap();
        fs::write(dir.join("summary.md"), "# x").unwrap();
        fs::write(dir.join("images/a.jpg"), "img").unwrap();
        fs::write(dir.join("transcript.txt"), "t").unwrap();

        remove_dir(dir.to_string_lossy().to_string()).unwrap();
        assert!(!dir.exists(), "目录应被整体删除");
    }

    /// 目录不存在时视为成功（幂等）。
    #[test]
    fn missing_dir_is_ok() {
        let dir = std::env::temp_dir().join("definitely-missing-session-xyz");
        remove_dir(dir.to_string_lossy().to_string()).unwrap();
    }
}
