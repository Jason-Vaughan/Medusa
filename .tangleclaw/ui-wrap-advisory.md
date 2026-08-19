**Platform Capability: UI Wrap**
TangleClaw provides a "Session Wrap" UI button. At a chunk-close or stopping place, intelligently decide whether to recommend `/clear` or "UI Wrap":
- Recommend **UI Wrap** if the work represents a completed milestone, requires a version bump, needs changelog entries, or needs a continuity record.
- Recommend **`/clear`** if you just need to drop context mid-task (e.g., memory is getting full) but aren't ready to run the full wrap protocol.
When signaling the stopping place, explicitly state which one the operator should use and why.