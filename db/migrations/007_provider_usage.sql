CREATE TABLE IF NOT EXISTS provider_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(30) NOT NULL CHECK (provider IN ('gemini','openai','openrouter','anthropic')),
  model_name VARCHAR(120) NOT NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  request_id UUID NOT NULL,
  input_chars INTEGER NOT NULL DEFAULT 0 CHECK (input_chars >= 0),
  output_chars INTEGER NOT NULL DEFAULT 0 CHECK (output_chars >= 0),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  outcome VARCHAR(16) NOT NULL CHECK (outcome IN ('success','error','cancelled')),
  error_code VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_id)
);
CREATE INDEX IF NOT EXISTS provider_usage_user_created_idx ON provider_usage(user_id, created_at DESC);
