mod models;
mod routes;
mod services;
mod utils;

use axum::{
  routing::post,
  Router
};
use reqwest::Client;
use std::{net::SocketAddr, sync::Arc};
use tower_http::cors::{Any, CorsLayer};
use tracing::info;

use crate::models::AppState;
use crate::routes::summarize;

#[tokio::main]
async fn main() {
  tracing_subscriber::fmt()
    .with_env_filter("memflow=info")
    .init();

  let state = AppState {
    http: Client::builder()
      .user_agent("Memflow/0.1")
      .build()
      .expect("http client")
  };

  let app = Router::new()
    .route("/api/summarize", post(summarize))
    .layer(
      CorsLayer::new()
        .allow_methods(Any)
        .allow_headers(Any)
        .allow_origin(Any)
    )
    .with_state(Arc::new(state));

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
