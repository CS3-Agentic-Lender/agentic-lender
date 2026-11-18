# ecs.tf: runs al-ai on Fargate behind /ai/* (AL-230).
#
# Three pieces:
#   - the cluster: a named group the services live in. al-core joins it later.
#   - the task definition: the recipe for one al-ai container, i.e. which image, how much CPU and memory,
#     its settings and secrets, and where its output goes.
#   - the service: keeps one task from that recipe running, and puts it in the al-ai target group so
#     the load balancer sends it /ai/* (load-balancer.tf).
#
#   ./deploy/al deploy <commit>
#     └─▶ new task definition (image al-ai:<commit>)
#           └─▶ service starts a new task next to the old one ──▶ /ai/health passes ──▶ old task stops
#                                                             └─▶ keeps failing ──▶ rolls back to the old one
#
# Fargate means AWS runs the machine; we only say how big the task is. ARM64 (Graviton) is about 20%
# cheaper than x86 and matches the images GitHub Actions builds.
#
# Costs about EUR 17 a month for the task (0.5 vCPU and 2 GB on ARM64, about USD 0.023 an hour) and
# EUR 3.50 for its public IPv4 address. The cluster itself is free.

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
    CORS_ALLOWED_ORIGINS = "https://app.${var.domain}"
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

  container_definitions = jsonencode([{
    name      = "al-ai"
    image     = "${data.aws_ecr_repository.al_ai.repository_url}:${var.image_tag}"
    essential = true # if this container stops, the whole task stops and ECS starts a new one

    portMappings = [{ containerPort = local.al_ai_port, protocol = "tcp" }]

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
