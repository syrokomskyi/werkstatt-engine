/*
<MODULE_CONTRACT>
<purpose>Facilitates the registration and retrieval of kernel commands and pipelines within the system.</purpose>
<non-goals>
  <item>Do not handle command execution or pipeline orchestration.</item>
  <item>Do not manage raw data parsing or external configuration.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY>
*/

import type { KernelCommandDefinition, KernelModuleRegistry, KernelPipelineStep } from "./types.ts";
// @ai-invariant: Command registry must keep command names unique and never bypass typed flag validation.
export class KernelRegistry implements KernelModuleRegistry {
  readonly commands = new Map<string, KernelCommandDefinition>();
  readonly pipelines = new Map<string, KernelPipelineStep[]>();
  readonly commandModules = new Map<string, string>();
  currentModuleName: string | undefined;

  registerCommand(command: KernelCommandDefinition): void {
    const existing = this.commands.get(command.name);
    if (existing) {
      if (existing.execute === command.execute) return;
      throw new Error(
        `Kernel command already registered: ${command.name} (conflict between modules)`,
      );
    }

    this.commands.set(command.name, command);
    if (this.currentModuleName) {
      this.commandModules.set(command.name, this.currentModuleName);
    }
  }

  registerPipeline(name: string, steps: KernelPipelineStep[]): void {
    if (this.pipelines.has(name)) {
      throw new Error(`Kernel pipeline already registered: ${name}`);
    }

    this.pipelines.set(name, [...steps]);
  }
  getCommand(name: string): KernelCommandDefinition | undefined {
    return this.commands.get(name);
  }

  getPipeline(name: string): KernelPipelineStep[] | undefined {
    const pipeline = this.pipelines.get(name);
    return pipeline ? [...pipeline] : undefined;
  }

  listCommandNames(): string[] {
    return [...this.commands.keys()].sort();
  }
}
