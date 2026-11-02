FROM oven/bun:1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg zip curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
  && chmod +x /usr/local/bin/yt-dlp
WORKDIR /app
COPY server.ts index.html theme.css ./
EXPOSE 3000
CMD ["bun", "server.ts"]
