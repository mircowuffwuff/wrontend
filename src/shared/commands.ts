// the harness's slash commands as a prompt types them: what the prompt's text asks for, and which commands match it

import type { AvailableCommand } from '@agentclientprotocol/sdk';

// the filter typed after a slash at the very start of the prompt, or null when no command name is being typed: a space
// ends the name, and what follows it is the command's own input
export function slashQuery(text: string): string | null {
  const m = /^\/(\S*)$/.exec(text);
  return m ? m[1] : null;
}

export interface CommandMatch {
  command: AvailableCommand;
  // where the query starts in the name, or null when only the description matched
  at: number | null;
}

// names that start with the query first, then names that contain it, then commands whose description does -- each tier
// in the harness's own order. case is ignored
export function matchCommands(commands: AvailableCommand[], query: string): CommandMatch[] {
  const q = query.toLowerCase();
  const tiers: CommandMatch[][] = [[], [], []];
  for (const command of commands) {
    const at = command.name.toLowerCase().indexOf(q);
    if (at === 0) tiers[0].push({ command, at });
    else if (at > 0) tiers[1].push({ command, at });
    else if (command.description.toLowerCase().includes(q)) tiers[2].push({ command, at: null });
  }
  return tiers.flat();
}

// the prompt's text once a command is picked: its name and a space, ready for its input. the harness takes /name input
// as plain prompt text
export function pickedText(command: AvailableCommand): string {
  return `/${command.name} `;
}
