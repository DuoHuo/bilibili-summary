#!/usr/bin/env bash
# fetch-binaries.sh — 拉取三平台外部二进制（yt-dlp / ffmpeg / whisper-cli）为 Tauri sidecar。
#
# 用法：
#   bash scripts/fetch-binaries.sh                # 按当前 host 的 target-triple 拉取
#   bash scripts/fetch-binaries.sh x86_64-unknown-linux-gnu   # 指定 target-triple
#
# 输出到 src-tauri/binaries/{name}-{target-triple}（Tauri externalBin 约定命名）。
# 幂等：已存在的文件跳过（不覆盖）。开发期走 PATH，仅打包前调用本脚本。
#
# 已知限制（2026-08 验证）：
#   - whisper.cpp 官方 releases 不提供 macOS arm64 预编译 CLI（只有 ubuntu/win/macos-x64）
#     → macOS arm64 打包时需从源码构建或 PATH 提供 whisper-cli，脚本会给出提示。
#   - ffmpeg 用 BtbN/FFmpeg-Builds 静态构建；whisper 用 ggml-org/whisper.cpp releases。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${SCRIPT_DIR}/../src-tauri/binaries"
MIRROR_DIR="${SCRIPT_DIR}/../third_party/binaries"   # 预编译镜像 submodule（可选）
mkdir -p "${BIN_DIR}"

# 从预编译镜像 submodule 复制（存在则用，否则返回 1 走下载/构建回退）
mirror_copy() {
  local name="$1"
  local src="${MIRROR_DIR}/${name}-${TARGET_TRIPLE}${EXE_SUFFIX}"
  if [ -f "${src}" ] && [ -s "${src}" ]; then
    echo "  📦 从镜像复制: ${name}"
    install -m 0755 "${src}" "${BIN_DIR}/${name}-${TARGET_TRIPLE}${EXE_SUFFIX}"
    return 0
  fi
  return 1
}

HOST_TRIPLE="$(rustc -vV 2>/dev/null | sed -n 's/^host: //p' || true)"
TARGET_TRIPLE="${1:-${HOST_TRIPLE:-x86_64-unknown-linux-gnu}}"
echo "🎯 target-triple: ${TARGET_TRIPLE}"

# ---------- 平台映射 ----------
case "${TARGET_TRIPLE}" in
  x86_64-unknown-linux-gnu)
    FFMPEG_ASSET="ffmpeg-master-latest-linux64-gpl.tar.xz"
    WHISPER_ASSET="whisper-bin-ubuntu-x64.tar.gz"
    YTDLP_ASSET="yt-dlp_linux"
    EXE_SUFFIX=""
    ;;
  aarch64-unknown-linux-gnu)
    FFMPEG_ASSET="ffmpeg-master-latest-linuxarm64-gpl.tar.xz"
    WHISPER_ASSET="whisper-bin-ubuntu-arm64.tar.gz"
    YTDLP_ASSET="yt-dlp_linux_aarch64"
    EXE_SUFFIX=""
    ;;
  x86_64-pc-windows-msvc)
    FFMPEG_ASSET="ffmpeg-master-latest-win64-gpl.zip"
    WHISPER_ASSET="whisper-bin-Win32.zip"
    YTDLP_ASSET="yt-dlp.exe"
    EXE_SUFFIX=".exe"
    ;;
  aarch64-pc-windows-msvc)
    FFMPEG_ASSET="ffmpeg-master-latest-winarm64-gpl.zip"
    WHISPER_ASSET="whisper-bin-Win32.zip"   # whisper 无 arm64 windows 预编译，回退 Win32（x64）
    YTDLP_ASSET="yt-dlp_arm64.exe"
    EXE_SUFFIX=".exe"
    ;;
  x86_64-apple-darwin)
    FFMPEG_ASSET=""   # macOS 无 BtbN 静态构建；ffmpeg 由 PATH（homebrew）提供
    WHISPER_ASSET="whisper-bin-x64.zip"
    YTDLP_ASSET="yt-dlp_macos"
    EXE_SUFFIX=""
    ;;
  aarch64-apple-darwin)
    FFMPEG_ASSET=""   # macOS 无 BtbN 静态构建；ffmpeg 由 PATH（homebrew）提供
    WHISPER_ASSET=""   # 无官方预编译；从 submodule 源码构建
    YTDLP_ASSET="yt-dlp_macos"
    EXE_SUFFIX=""
    ;;
  *)
    echo "⚠️  未识别的 target-triple: ${TARGET_TRIPLE}（无预配置的二进制来源）" >&2
    exit 1
    ;;
esac

# ---------- 下载辅助 ----------
download() {
  local url="$1" out="$2"
  if [ -f "${out}" ] && [ -s "${out}" ]; then
    echo "  跳过（已存在）: ${out}"
    return 0
  fi
  echo "  下载 ${url}"
  curl -fL --retry 3 -o "${out}" "${url}"
}

# ---------- yt-dlp（单文件可执行） ----------
if mirror_copy yt-dlp; then
  :
elif [ -n "${YTDLP_ASSET}" ]; then
  echo "📦 yt-dlp"
  YTDLP_TMP="${BIN_DIR}/.ytdlp-dl"
  download "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_ASSET}" "${YTDLP_TMP}"
  install -m 0755 "${YTDLP_TMP}" "${BIN_DIR}/yt-dlp-${TARGET_TRIPLE}${EXE_SUFFIX}"
  rm -f "${YTDLP_TMP}"
fi

# ---------- ffmpeg（BtbN 静态构建，需解压） ----------
if mirror_copy ffmpeg; then
  echo "✅ ffmpeg 已就绪"
elif [ -n "${FFMPEG_ASSET}" ]; then
  echo "🎞️  ffmpeg"
  FFMPEG_TMP="${BIN_DIR}/.ffmpeg-dl.${FFMPEG_ASSET##*.}"
  download "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/${FFMPEG_ASSET}" "${FFMPEG_TMP}"
  FFMPEG_TMPDIR="$(mktemp -d)"
  case "${FFMPEG_ASSET}" in
    *.zip)  unzip -q "${FFMPEG_TMP}" -d "${FFMPEG_TMPDIR}" ;;
    *.xz)   tar -xJf "${FFMPEG_TMP}" -C "${FFMPEG_TMPDIR}" ;;
  esac
  FFMPEG_BIN="$(find "${FFMPEG_TMPDIR}" -type f -name "ffmpeg${EXE_SUFFIX}" | head -1)"
  if [ -z "${FFMPEG_BIN}" ]; then
    echo "❌ 未在解压产物中找到 ffmpeg" >&2
    rm -rf "${FFMPEG_TMPDIR}"
    exit 1
  fi
  install -m 0755 "${FFMPEG_BIN}" "${BIN_DIR}/ffmpeg-${TARGET_TRIPLE}${EXE_SUFFIX}"
  rm -rf "${FFMPEG_TMPDIR}" "${FFMPEG_TMP}"
fi

# ---------- whisper-cli（ggml-org/whisper.cpp） ----------
if mirror_copy whisper-cli; then
  echo "✅ whisper-cli 已就绪"
elif [ -n "${WHISPER_ASSET}" ]; then
  echo "🎧  whisper-cli"
  WHISPER_TMP="${BIN_DIR}/.whisper-dl.zip"
  download "https://github.com/ggml-org/whisper.cpp/releases/latest/download/${WHISPER_ASSET}" "${WHISPER_TMP}"
  WHISPER_TMPDIR="$(mktemp -d)"
  unzip -q "${WHISPER_TMP}" -d "${WHISPER_TMPDIR}"
  WHISPER_BIN="$(find "${WHISPER_TMPDIR}" -type f \( -name "whisper-cli${EXE_SUFFIX}" -o -name "main${EXE_SUFFIX}" \) | head -1)"
  if [ -z "${WHISPER_BIN}" ]; then
    echo "❌ 未在解压产物中找到 whisper-cli" >&2
    rm -rf "${WHISPER_TMPDIR}"
    exit 1
  fi
  install -m 0755 "${WHISPER_BIN}" "${BIN_DIR}/whisper-cli-${TARGET_TRIPLE}${EXE_SUFFIX}"
  rm -rf "${WHISPER_TMPDIR}" "${WHISPER_TMP}"
else
  echo "⚠️  ${TARGET_TRIPLE} 无官方 whisper-cli 预编译包，尝试从 submodule 源码构建。"
  if [ -d "${SCRIPT_DIR}/../third_party/whisper.cpp" ]; then
    echo "🎧  从 submodule 构建 whisper-cli（third_party/whisper.cpp）"
    WHISPER_SRC="${SCRIPT_DIR}/../third_party/whisper.cpp"
    BUILD_DIR="${WHISPER_SRC}/build"
    cmake -B "${BUILD_DIR}" -S "${WHISPER_SRC}" -DCMAKE_BUILD_TYPE=Release \
      -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON >/dev/null
    cmake --build "${BUILD_DIR}" --target whisper-cli -j"$(sysctl -n hw.ncpu 2>/dev/null || echo 4)" >/dev/null
    WHISPER_BIN="${BUILD_DIR}/bin/whisper-cli${EXE_SUFFIX}"
    if [ ! -f "${WHISPER_BIN}" ]; then
      echo "❌ submodule 构建失败：未找到 ${WHISPER_BIN}" >&2
      exit 1
    fi
    install -m 0755 "${WHISPER_BIN}" "${BIN_DIR}/whisper-cli-${TARGET_TRIPLE}${EXE_SUFFIX}"
  else
    echo "❌ 未找到 third_party/whisper.cpp submodule，请先: git submodule update --init --recursive" >&2
    echo "   或者通过 PATH 提供 whisper-cli。" >&2
    exit 1
  fi
fi

echo "✅ 完成。产物："
ls -la "${BIN_DIR}"
