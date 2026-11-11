#!/usr/bin/env bash
set -euo pipefail

# Build only: no AWS CLI, push, layer publication or Terraform apply.
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$repo_dir"

ffmpeg_version='8.1.3'
ffmpeg_sha256='7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3'
build_dir="$(mktemp -d "${TMPDIR:-/tmp}/acervo-subtitles.XXXXXX")"
container_id=''

cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$container_id" ]]; then
    docker rm "$container_id" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$build_dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

archive="$build_dir/ffmpeg.tar.xz"
curl --fail --location --show-error \
  "https://ffmpeg.org/releases/ffmpeg-${ffmpeg_version}.tar.xz" --output "$archive"
printf '%s  %s\n' "$ffmpeg_sha256" "$archive" | sha256sum --check

cp subtitles/Dockerfile subtitles/handler.py "$build_dir/"
docker build --platform linux/amd64 -t acervo-subtitles:local "$build_dir"
container_id="$(docker create acervo-subtitles:local)"
mkdir -p infra/.build/subtitles
docker cp "$container_id:/artifacts/ffmpeg-layer.zip" infra/.build/subtitles/ffmpeg-layer.zip
