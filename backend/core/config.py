from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # Project
    PROJECT_NAME: str = "Cubot IDE"
    PROJECT_VERSION: str = "0.1.0"
    
    # Auth
    NEXTAUTH_SECRET: str

    # MongoDB
    MONGODB_URI: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "cubot_ide"
    
    # AWS Bedrock
    AWS_REGION: str = "us-east-1"
    AWS_ACCESS_KEY_ID: Optional[str] = None
    AWS_SECRET_ACCESS_KEY: Optional[str] = None
    BEDROCK_MODEL_ID: str = "openai.gpt-oss-120b-1:0"
    
    # Docker
    DOCKER_SOCKET: str = "unix:///var/run/docker.sock"
    
    # Compiler Images
    ARDUINO_IMAGE: str = "cubot/arduino-compiler:latest"
    TI_ARM_IMAGE: str = "cubot/ti-arm-compiler:latest"
    ESP32_IMAGE: str = "cubot/esp32-compiler:latest"
    
    # Simulator Image
    SIMULATOR_IMAGE: str = "cubot/avr-simulator:latest"
    
    # Compilation settings
    COMPILE_TIMEOUT: int = 60  # seconds
    MAX_OUTPUT_SIZE: int = 1024 * 1024  # 1MB

    # Kubernetes sandboxes (ROS projects). Cluster credentials come from the
    # in-cluster service account, else $KUBECONFIG / ~/.kube/config.
    SANDBOX_NAMESPACE: str = "cubot-sandboxes"
    SANDBOX_IMAGE: str = "ros:humble-ros-base"
    SANDBOX_STARTUP_TIMEOUT: int = 300  # seconds; first image pull can be slow
    SANDBOX_CPU_REQUEST: str = "250m"
    SANDBOX_CPU_LIMIT: str = "2"
    SANDBOX_MEMORY_REQUEST: str = "512Mi"
    SANDBOX_MEMORY_LIMIT: str = "2Gi"
    SANDBOX_DISK_LIMIT: str = "5Gi"

    # Exa Web Search
    EXA_API_KEY: Optional[str] = None

    # CORS
    ALLOWED_ORIGINS: str = "*"

    class Config:
        env_file = ".env"
        extra = "allow"


settings = Settings()
