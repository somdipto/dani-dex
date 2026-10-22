# One-container Dani gateway for a container platform (Standard shape, 1 vCPU / 2 GB).
# Build time installs everything with a placeholder token; at start the real
# token comes from the platform secret DANI_TELEGRAM_TOKEN and is written to a
# 0600 file, then removed from the environment before any service starts.
# UNTESTED here: this sandbox has no container runtime.
FROM debian:12-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates tar openssl coreutils xz-utils squashfs-tools procps git && rm -rf /var/lib/apt/lists/*
RUN useradd -m -s /bin/bash dani
USER dani
WORKDIR /home/dani
COPY --chown=dani:dani . /home/dani/src
RUN TELEGRAM_BOT_TOKEN=0:build DANI_ALEXA_SRC=/home/dani/src NO_SERVICE=1 SKIP_SELFTEST=1 bash /home/dani/src/install.sh
ENV DANI_MCP_HOST=0.0.0.0 MCP_PORT=8080
EXPOSE 8080
ENTRYPOINT ["/home/dani/src/docker-entrypoint.sh"]
