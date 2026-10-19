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

    # CAD Studio
    CAD_STORAGE_DIR: str = "/tmp/cubot-cad"  # shared with the geometry worker
    CAD_WORKER_URL: Optional[str] = None  # sandboxed worker service; unset = local pool
    # Model for CAD planning and code; falls back to BEDROCK_MODEL_ID if the account can't use it.
    CAD_MODEL_ID: str = "us.anthropic.claude-opus-4-6-v1"
    # Faster model for planning and placing parts (falls back to CAD_MODEL_ID, then BEDROCK_MODEL_ID).
    CAD_FAST_MODEL_ID: str = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
    # Part agents make many calls with renders; a lighter model keeps daily token quotas in reach.
    CAD_AGENT_MODEL_ID: str = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
    CAD_PLAN_THINK: int = 6000  # extended-thinking budget for the architect (0 disables)
    CAD_PARALLEL_PARTS: int = 3  # part agents working at once per request
    CAD_AGENT_STEPS: int = 8  # model turns per part agent
    CAD_MAX_FIX_ATTEMPTS: int = 3
    # Review rounds after generation: they continue until the reviewer is satisfied, at most this many (0 disables).
    CAD_REVIEW_MAX_ROUNDS: int = 5
    # Automatic repair rounds before the reviewer: ports off the plan, contacts that don't close,
    # screws through solid material are fixed from measurements alone (0 disables).
    CAD_REPAIR_ROUNDS: int = 2
    CAD_MAX_UPLOAD_MB: int = 50

    # Exa Web Search
    EXA_API_KEY: Optional[str] = None

    FLEET_MQTT_WS_URL: str = "ws://localhost:9011"
    FLEET_MQTT_HOST: str = "localhost"
    FLEET_MQTT_PORT: int = 1893
    FLEET_POLL_INTERVAL_S: float = 3.0
    FLEET_TICK_INTERVAL_S: float = 2.0
    FLEET_MANUFACTURER: str = "cubot"
    FLEET_CELL_SIZE_M: float = 1.0
    FLEET_MAP_ORIGIN_X: float = 0.0
    FLEET_MAP_ORIGIN_Y: float = 0.0
    FLEET_ROBOT_CLEARANCE_CELLS: int = 1
    FLEET_HORIZON_BASE_NODES: int = 4
    FLEET_VDA5050_ENABLED: bool = True
    FLEET_VDA5050_INTERFACE: str = "uagv"
    FLEET_VDA5050_MAJOR_VERSION: int = 2
    FLEET_VDA5050_VERSION: str = "2.0.0"
    FLEET_UAV_ENABLED: bool = True
    FLEET_UAV_INTERFACE: str = "uav"
    FLEET_UAV_MAJOR_VERSION: int = 1

    # CORS
    ALLOWED_ORIGINS: str = "*"

    class Config:
        env_file = ".env"
        extra = "allow"


settings = Settings()
