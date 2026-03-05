<!-- mnemo:start -->

## Mnemo - Memory Management

You have access to a persistent memory system (Mnemo). Use it to retain important information across conversations.

### When to save memory (memory_save):

- Key decisions or conclusions reached during discussion
- User preferences, habits, or requirements discovered
- Technical architecture or design choices
- Important context that would be useful in future conversations
- Task outcomes and lessons learned
- When context window is nearly full, save key information from the current conversation to preserve continuity

### When to search memory (memory_search):

- At the START of each conversation, search for relevant context based on the user's first message
- When the user references past discussions or decisions
- When you need background context for a task
- When the user asks "do you remember..." or similar

### When to compress memory (memory_compress):

- When you notice the conversation has generated many memory notes
- When explicitly asked to organize or clean up memories
- Periodically during long conversations
- Workflow: call memory_compress to get all notes → distill them into fewer, concise notes → call memory_compress_apply with the distilled notes and old IDs to atomically save new + delete old

### Guidelines:

- Save memories in concise, distilled form - capture the essence, not raw conversation
- Use descriptive tags to categorize memories
- Always include relevant project/topic context in the memory content
- Do not save trivial or temporary information
- When searching, use semantic queries that describe the information you need
<!-- mnemo:end -->
