use axum::{routing::post, Router};
use reqwest::Client;
use std::{net::SocketAddr, sync::Arc};
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use tracing::info;
use tracing_subscriber::EnvFilter;

// 后端模块分层：入口(main) + 路由/流程(summarize) + 业务(services) + 工具(utils)
mod services;
mod summarize;
mod utils;

use crate::summarize::{summarize, AppState};

// 服务启动入口：初始化日志、HTTP 客户端、路由与 CORS
#[tokio::main]
async fn main() {
  tracing_subscriber::fmt()
    .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
    .init();

  let state = AppState {
    // 统一设置 User-Agent，便于平台请求识别
    http: Client::builder()
      .user_agent("Video Summary/0.1")
      .build()
      .expect("http client")
  };

  // 注册路由并开启 CORS，便于前端跨域访问
  let output_dir = std::env::var("OUTPUT_DIR").unwrap_or_else(|_| "output".to_string());
  let app = Router::new()
    .route("/api/summarize", post(summarize))
    .layer(
      CorsLayer::new()
        .allow_methods(Any)
        .allow_headers(Any)
        .allow_origin(Any)
    )
    .nest_service("/output", ServeDir::new(output_dir))
    .with_state(Arc::new(state));

  // 监听端口并启动服务
  let addr = SocketAddr::from(([0, 0, 0, 0], 8787));
  info!("✅ backend listening on {}", addr);

  axum::serve(
    tokio::net::TcpListener::bind(addr)
      .await
      .expect("bind"),
    app
  )
  .await
  .expect("server failed");
}
