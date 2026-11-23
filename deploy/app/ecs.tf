# ecs.tf: runs al-ai on Fargate behind /ai/* (AL-230) and al-core behind /core/* (AL-228).
#
# Three pieces:
#   - the cluster: a named group both services live in.
#   - a task definition per service: the recipe for one container, i.e. which image, how much CPU and
#     memory, its settings and secrets, and where its output goes.
#   - a service per service: keeps one task from that recipe running, and puts it in its target group so
#     the load balancer sends it /ai/* or /core/* (load-balancer.tf).
#
#   ./deploy/al deploy <commit>
#     └─▶ new task definitions (images al-ai:<commit> and al-core:<commit>)
#           └─▶ each service starts a new task next to the old one ──▶ its health check passes ──▶ old task stops
#                                                                  └─▶ keeps failing ──▶ rolls back to the old one
#
# Fargate means AWS runs the machine; we only say how big the task is. ARM64 (Graviton) is about 20%
# cheaper than x86 and matches the images GitHub Actions builds.
#
# Costs about EUR 17 a month for the al-ai task (0.5 vCPU and 2 GB on ARM64, about USD 0.023 an hour),
# EUR 7 for the al-core task (0.25 vCPU and 0.5 GB, about USD 0.010 an hour), and EUR 3.50 for each
# task's public IPv4 address. The cluster itself is free.

# ---- the cluster ---------------------------------------------------------------------------------

resource "aws_ecs_cluster" "main" {
  name = "agentic-lender"

  # Container Insights adds detailed CPU and memory metrics, billed per metric. Off to save money;
  # the load balancer's health checks and alarms.tf already say when a task is down.
  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

# ---- the al-ai task definition -------------------------------------------------------------------

locals {
  al_ai_port = local.services.ai.port # 5001, the same as on the laptop

  # Plain settings, safe to show in the console. No *_EMULATOR_HOST here, so al-ai talks to the real Firebase.
  al_ai_environment = {
    FIREBASE_PROJECT_ID  = "agentic-lender-a0f1c"
    AL_AGENTS_CONFIG     = "agents.aws.json" # Bedrock in place of Ollama (al-ai/app/llm/agents.aws.json)
    AUTO_START_COMMITTEE = "true"            # run the committee for each new application
    CORS_ALLOWED_ORIGINS = "https://${var.domain}"
    AWS_REGION           = var.region # where al-ai calls Bedrock
  }

  # The four API keys sit in one JSON secret. "<arn>:<key>::" tells ECS to pull out just that key.
  al_ai_api_keys = ["GROQ_API_KEY", "GEMINI_API_KEY", "MISTRAL_API_KEY", "SERPER_API_KEY"]
}

resource "aws_ecs_task_definition" "al_ai" {
  family                   = "agentic-lender-al-ai"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc" # each task gets its own network card and address (Fargate needs this)
  cpu                      = 512      # 0.5 vCPU
  memory                   = 2048     # 2 GB: the valuation model and its libraries stay loaded in memory

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  # Two roles (foundations/al-ai-roles.tf): ECS uses the execution role to start the task,
  # al-ai's code uses the task role for Bedrock.
  execution_role_arn = data.aws_iam_role.al_ai_execution.arn
  task_role_arn      = data.aws_iam_role.al_ai_task.arn

  # Fargate task storage with no host path: empty when the task starts, deleted when it stops.
  volume {
    name = "tmp"
  }

  container_definitions = jsonencode([{
    name      = "al-ai"
    image     = "${data.aws_ecr_repository.al_ai.repository_url}:${var.image_tag}"
    essential = true # if this container stops, the whole task stops and ECS starts a new one

    portMappings = [{ containerPort = local.al_ai_port, protocol = "tcp" }]

    # The image can't be changed while it runs. The only writable place is /tmp, the scratch volume above,
    # that holds the Firebase key file entrypoint.sh writes and matplotlib's cache, and goes with the task.
    # The Dockerfile's VOLUME ["/tmp"] gives it the image's permissions, so the non-root user can write it.
    readonlyRootFilesystem = true
    mountPoints            = [{ sourceVolume = "tmp", containerPath = "/tmp", readOnly = false }]

    environment = [for name, value in local.al_ai_environment : { name = name, value = value }]

    # ECS reads these when the task starts and hands them to the container as environment variables.
    # Only the secret's address is in here, never the value, so the plan and the state hold no keys.
    secrets = concat(
      [for key in local.al_ai_api_keys : { name = key, valueFrom = "${data.aws_secretsmanager_secret.al_ai_api_keys.arn}:${key}::" }],
      # The whole service account file. al-ai/entrypoint.sh writes it to a file at start-up.
      [{ name = "FIREBASE_SERVICE_ACCOUNT_JSON", valueFrom = data.aws_secretsmanager_secret.al_ai_firebase_service_account.arn }],
    )

    # Everything the container prints goes to the al-ai log group, one stream per task.
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = data.aws_cloudwatch_log_group.al_ai.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "al-ai" # streams are named al-ai/al-ai/<task id>
      }
    }

    # No container health check: the load balancer's check on /ai/health (load-balancer.tf) is the one
    # ECS acts on, and a second one would only be another thing to keep in step.
  }])
}

# ---- the al-ai service ---------------------------------------------------------------------------

resource "aws_ecs_service" "al_ai" {
  name            = "al-ai"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.al_ai.arn
  launch_type     = "FARGATE"
  desired_count   = 1 # fixed, no auto-scaling: a handful of users at the demo

  # The public subnets with a public IP, because there's no NAT gateway (network.tf). The tasks group
  # still lets in only the load balancer (security-groups.tf).
  network_configuration {
    subnets          = [for subnet in aws_subnet.public : subnet.id]
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = true
  }

  # Register each task in the al-ai target group, so the load balancer sends it /ai/*.
  load_balancer {
    target_group_arn = aws_lb_target_group.service["ai"].arn
    container_name   = "al-ai"
    container_port   = local.al_ai_port
  }

  # al-ai loads its model at start-up. For the first 2 minutes a failed health check doesn't count,
  # so a slow start isn't mistaken for a broken build.
  health_check_grace_period_seconds = 120

  # On a deploy, start the new task next to the old one (up to 200%) and never drop below one running
  # task (100%), so /ai/* stays up while the new build starts.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  # If the new tasks keep failing to start or failing the health check, ECS stops trying and goes back
  # to the last build that worked, by itself.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # ECS can only register tasks in a target group the load balancer already uses, so the rules come first.
  depends_on = [aws_lb_listener_rule.service]
}

# ---- the al-core task definition -----------------------------------------------------------------

locals {
  al_core_port = local.services.core.port # 5002, the same as on the laptop

  # Plain settings, safe to show in the console. No *_EMULATOR_HOST here, so al-core talks to the real
  # Firebase. No GOOGLE_APPLICATION_CREDENTIALS either: al-core/entrypoint.sh sets it from
  # FIREBASE_SERVICE_ACCOUNT_JSON.
  al_core_environment = {
    FIREBASE_PROJECT_ID  = "agentic-lender-a0f1c"
    CORS_ALLOWED_ORIGINS = "https://${var.domain}"
  }

  # Where the contracts are: the pair Dumi deployed and verified on Polygon Amoy on 23 November
  # (al-core/chain/deployments/amoy.json, docs/infrastructure.md "Contracts on Polygon Amoy"). The two
  # wallet keys come from the chain-keys secret below. The addresses are set here because
  # chain/deployments/ isn't in the image. CHAIN_START_BLOCK is the deploy block: PublicNode refuses a log
  # query over 10,000 blocks, so al-core looks a past mint, close or audit write up newest first and stops there.
  #
  # Leave a setting null rather than "" if it's ever unset again: al-core treats an empty CHAIN_NETWORK or
  # address as unset, but an empty CHAIN_RPC_URL is used as it is instead of falling back to the local node.
  #
  # The RPC is PublicNode's free endpoint with no key in it, so it's a plain setting. A provider URL with an
  # API key in it (Alchemy, Infura) would be a secret: chain-keys secret and al_core_secret_keys, not here.
  al_core_chain = {
    CHAIN_RPC_URL          = "https://polygon-amoy-bor-rpc.publicnode.com"
    CHAIN_NETWORK          = "amoy"
    LOAN_NOTE_ADDRESS      = "0x12df1c6F6457F337190791527667B8BA4EACEFD4"
    AUDIT_REGISTRY_ADDRESS = "0x0AA97a061607DF09e1acC208dEf71D7d2D5af3C7"
    CHAIN_START_BLOCK      = "53619738"
  }

  # Which secret holds each key (foundations/al-core-secrets.tf). Both are JSON objects, and
  # "<arn>:<key>::" tells ECS to pull out just that key. A name missing from the secret's JSON stops the
  # task from starting, so these must match deploy/README.md, "Filling the al-core secrets", exactly.
  al_core_secret_keys = {
    BORROWER_REF_SALT           = data.aws_secretsmanager_secret.al_core_keys.arn
    STRIPE_SECRET_KEY           = data.aws_secretsmanager_secret.al_core_keys.arn
    STRIPE_WEBHOOK_SECRET       = data.aws_secretsmanager_secret.al_core_keys.arn
    CHAIN_MINTER_PRIVATE_KEY    = data.aws_secretsmanager_secret.al_core_chain_keys.arn
    CHAIN_REGISTRAR_PRIVATE_KEY = data.aws_secretsmanager_secret.al_core_chain_keys.arn
  }
}

resource "aws_ecs_task_definition" "al_core" {
  family                   = "agentic-lender-al-core"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256 # 0.25 vCPU: al-core forwards requests to Firestore, Stripe and the chain, and loads no model
  memory                   = 512 # 0.5 GB, the smallest Fargate allows with 0.25 vCPU

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  # Two roles (foundations/al-core-roles.tf): ECS uses the execution role to start the task and read the
  # secrets. The task role has no permissions, because al-core's code makes no AWS calls.
  execution_role_arn = data.aws_iam_role.al_core_execution.arn
  task_role_arn      = data.aws_iam_role.al_core_task.arn

  container_definitions = jsonencode([{
    name      = "al-core"
    image     = "${data.aws_ecr_repository.al_core.repository_url}:${var.image_tag}"
    essential = true

    portMappings = [{ containerPort = local.al_core_port, protocol = "tcp" }]

    environment = [
      for name, value in merge(local.al_core_environment, local.al_core_chain) : { name = name, value = value }
      if value != null
    ]

    # Read by ECS when the task starts, as with al-ai: only the secrets' addresses are in here.
    secrets = concat(
      [for key, arn in local.al_core_secret_keys : { name = key, valueFrom = "${arn}:${key}::" }],
      # The whole service account file. al-core/entrypoint.sh writes it to a file at start-up.
      [{ name = "FIREBASE_SERVICE_ACCOUNT_JSON", valueFrom = data.aws_secretsmanager_secret.al_core_firebase_service_account.arn }],
    )

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = data.aws_cloudwatch_log_group.al_core.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "al-core" # streams are named al-core/al-core/<task id>
      }
    }

    # No container health check here either: the load balancer's check on /core/health is the one ECS
    # acts on. (The image's own Docker HEALTHCHECK is ignored by ECS unless a task definition names one.)
  }])
}

# ---- the al-core service -------------------------------------------------------------------------

resource "aws_ecs_service" "al_core" {
  name            = "al-core"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.al_core.arn
  launch_type     = "FARGATE"
  desired_count   = 1

  # The same place and the same security group as al-ai: in only from the load balancer.
  network_configuration {
    subnets          = [for subnet in aws_subnet.public : subnet.id]
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = true
  }

  # Register each task in the al-core target group, so the load balancer sends it /core/*.
  load_balancer {
    target_group_arn = aws_lb_target_group.service["core"].arn
    container_name   = "al-core"
    container_port   = local.al_core_port
  }

  # al-core has no model to load: uvicorn answers /core/health within seconds (the image's own check
  # allows 15). One minute covers that on a quarter of a vCPU with room to spare, and half of al-ai's
  # two means a build that never comes up is rolled back sooner.
  health_check_grace_period_seconds = 60

  # The same safe swap as al-ai: the new task starts next to the old one, and /core/* never goes down.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener_rule.service]
}
