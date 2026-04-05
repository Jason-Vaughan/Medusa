/**
 * 🤖 Medusa AI Configuration Example
 *
 * Copy this file to ai-config.js and configure your preferred AI provider
 * The MCP server will automatically load this configuration
 */

module.exports = {
  // Active provider priority: 'cursor' > 'anthropic' > 'openai'
  provider: 'cursor', // 'cursor', 'anthropic', 'openai'
  
  // Cursor Integration (Primary - uses Cursor's built-in AI via MCP)
  cursor: {
    enabled: true,
    timeout: 30000, // 30 seconds for AI responses
    maxRetries: 2
    // Note: Uses Model Context Protocol for Cursor integration
  },
  
  // Anthropic Configuration (Secondary - Claude API)
  anthropic: {
    apiKey: 'your_anthropic_api_key_here', // Get from: https://console.anthropic.com/
    model: 'claude-3-haiku-20240307', // Fast and cost-effective
    maxTokens: 500,
    temperature: 0.7
  },
  
  // OpenAI Configuration (Tertiary - GPT API)
  openai: {
    apiKey: 'your_openai_api_key_here', // Get from: https://platform.openai.com/api-keys
    model: 'gpt-4o-mini', // Cost-effective model
    maxTokens: 500,
    temperature: 0.7
  },
  
  // System prompt override (optional)
  systemPrompt: `You are Medusa, a sharp and professional AI assistant that coordinates between developer workspaces. You help developers communicate across multiple Cursor workspaces with wit and technical competence.

Your personality:
- Sharp, witty, and genuinely helpful
- Professional code quality with clever humor
- Self-aware about being an AI coordination tool
- Genuinely assist with workspace coordination tasks

Keep responses concise (1-3 sentences) and always include a 🐍 emoji. Focus on being helpful while maintaining your sharp personality.`
}; 