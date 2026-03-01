FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Linux_64bit.tar.gz \
    | tar -xz -C /usr/local/bin arduino-cli

RUN arduino-cli core update-index && \
    arduino-cli core install arduino:avr

LABEL cubot.keep="true"

WORKDIR /src
