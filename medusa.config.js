// medusa.config.js
// Medusa Configuration - Because even snark needs proper setup

module.exports = {
  // Workspace identity (who you are in this situation)
  identity: "SPiT",

  // Sass level configuration
  sassLevel: "max",  // options: 'none', 'low', 'medium', 'max'

  // Emoji usage mode
  emojiMode: "passiveAggressive",  // options: 'off', 'neutral', 'aggressive', 'passiveAggressive'

  // Pre-built sassy response templates for maximum efficiency
  responseTemplates: [
    "You touched this last. It's yours now.",
    "This module smells like scope creep and trauma.",
    "Still waiting… like an unpaid intern with hope.",
    "If it breaks again, I'm blaming Cursor.",
    "Congrats on your latest regression.",
    "This code has more issues than a reality TV show.",
    "I see you've discovered new and creative ways to break things.",
    "Your commit message says 'fix' but your code says 'chaos'.",
    "This bug report reads like a cry for help.",
    "I'm not saying it's your fault, but... actually, yes I am.",
    "Another day, another deployment disaster.",
    "Your tests are passing, but your logic is questionable.",
    "This feature request sounds like a punishment.",
    "I've seen better code in a programming bootcamp.",
    "Your merge conflicts have merge conflicts."
  ],

  // Random CLI quotes for startup and various commands
  cliQuotes: [
    "Every time you type 'medusa', a junior dev levels up.",
    "Don't copy/paste manually — let Medusa handle it.",
    "Because sometimes your left hand has no idea what your right hand is coding.",
    "Now syncing your bad attitude.",
    "You started it. Medusa will finish it.",
    "If you're arguing with yourself across two workspaces… congratulations, you're in senior dev mode.",
    "Sending message. No, not like that. Medusa knows better.",
    "Medusa: Making passive-aggression productive since 2024.",
    "Your workspace drama, professionally managed.",
    "Because healthy communication is overrated.",
    "Facilitating toxic productivity, one message at a time.",
    "When you need to vent, but make it professional.",
    "Your personal workspace therapist (with attitude).",
    "Turning developer frustration into actionable snark.",
    "Medusa: Where your inner monologue gets a CLI."
  ],

  // Special trigger words and their behaviors
  triggerWords: {
    please: "Triggers default polite request flow (with hidden sarcasm)",
    slap: "Used to trigger a handoff or emergency ping",
    ferry: "Used to send a file across workspaces",
    therapy: "Provides emotional support (with maximum snark)",
    drama: "Shows conversation history with editorial commentary",
    clean: "Cleans up messages (with judgmental comments)",
    status: "Shows current status with attitude"
  },

  // Visual and interaction style preferences
  style: {
    promptPrefix: "Medusa says:",
    defaultRecipient: "TiLT",
    font: "monospace",
    colorScheme: "terminalDark",
    animationSpeed: "sassy", // options: 'none', 'fast', 'normal', 'sassy'
    verbosity: "maximum"     // options: 'minimal', 'normal', 'verbose', 'maximum'
  },

  // Notification preferences with personality
  notifications: {
    enabled: true,
    soundEnabled: true,
    aggressionLevel: "professional", // options: 'polite', 'normal', 'professional', 'savage'
    customSounds: {
      message: "bloop",
      priority: "ding",
      slap: "airhorn"
    }
  },

  // Message behavior configuration
  messaging: {
    autoSnark: true,           // Automatically add snark to messages
    severityDetection: true,   // Analyze and report message severity levels
    responseDelay: 0,          // Delay in ms before showing responses (for dramatic effect)
    maxMessageLength: 500,     // Character limit for messages
    archiveAfterDays: 30,      // Auto-archive old messages
    enableReadReceipts: true   // Show when messages are read (for maximum passive-aggression)
  },

  // Advanced snark configuration
  advanced: {
    contextAwareness: true,    // Use previous messages for contextual snark
    learningMode: false,       // Learn from user's communication patterns (future feature)
    customTemplates: [],       // User-defined response templates
    blacklistedWords: [],      // Words that trigger extra snark
    whitelistedWords: ["please", "thank you", "sorry"], // Words that reduce snark level

    // Personality quirks
    quirks: {
      addRandomEmojis: true,
      usePassiveVoice: true,
      includeTimestamps: true,
      addEditorialComments: true,
      useProgrammerHumor: true
    }
  },

  // Integration settings
  integrations: {
    cursor: {
      enabled: true,
      autoDetect: true,
      chatIntegration: false  // Future feature: integrate with Cursor chat
    },
    git: {
      enabled: false,         // Future feature: git commit message snark
      autoCommitMessages: false
    },
    slack: {
      enabled: false,         // Future feature: Slack integration
      webhook: null
    }
  },

  // Easter eggs and fun features
  easterEggs: {
    enabled: true,
    konami: "Unlocks maximum chaos mode",
    secretCommands: ["medusa --chaos", "medusa --zen", "medusa --therapist"],
    randomFacts: [
      "Medusa was originally going to be called 'SASS' but that was already taken.",
      "The average developer sends 47 passive-aggressive messages per day.",
      "Medusa has prevented approximately 0 workplace arguments (but made them more entertaining).",
      "Studies show that 73% of all statistics about developer communication are made up.",
      "Medusa: Proudly facilitating professional dysfunction since day one."
    ]
  },

  // Development and debugging
  debug: {
    enabled: false,
    logLevel: "info",         // options: 'error', 'warn', 'info', 'debug', 'verbose'
    saveDebugLogs: false,
    showInternalMessages: false
  },

  // Version and compatibility
  meta: {
    configVersion: "1.0.0",
    minMedusaVersion: "0.1.0",
    maxMedusaVersion: "1.0.0",
    lastModified: new Date().toISOString(),
    createdBy: "Medusa Wizard",
    notes: "Default configuration with maximum snark enabled"
  }
};