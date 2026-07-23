# Deployable backend — runs agent + app services in one container
FROM python:3.11-slim

# System deps: Java 21, Maven, Node.js 20, Git
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-21-jre-headless \
    maven \
    git \
    curl \
    procps \
    bash \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

ENV JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
ENV PATH="${JAVA_HOME}/bin:${PATH}"
ENV SCANNER_BACKEND=osv
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install Python deps
COPY requirements.txt /app/application/requirements.txt
RUN pip install --no-cache-dir --only-binary :all: -r /app/application/requirements.txt && pip install pytest

# Clone the agent repo — use commit SHA for cache busting
# Render sets RENDER_GIT_COMMIT env var, use it to force fresh clone every build
ARG RENDER_GIT_COMMIT=latest
RUN echo "Build commit: ${RENDER_GIT_COMMIT}" && \
    rm -rf /app/agent && \
    git clone https://github.com/Illusion0-0/security-remediation-agent.git /app/agent && \
    cd /app/agent && \
    git log --oneline -1

# Copy the application code
COPY . /app/application

# Write the startup script
RUN printf '#!/bin/bash\nset -e\ncd /app/agent\npython -m uvicorn api_server:app --host 0.0.0.0 --port 8081 &\nAGENT_PID=$!\nsleep 4\ncd /app/application\nADK_SERVER_URL=http://127.0.0.1:8081 python -m uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000} &\nAPP_PID=$!\nwait $AGENT_PID $APP_PID\n' > /app/start.sh \
    && chmod +x /app/start.sh

EXPOSE 8000
CMD ["/app/start.sh"]