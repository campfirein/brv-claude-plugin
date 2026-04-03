#!/usr/bin/env node

import { program } from "commander";
import { registerInstallCommand } from "./commands/install.js";
import { registerUninstallCommand } from "./commands/uninstall.js";
import { registerIngestCommand } from "./commands/ingest.js";
import { registerSyncCommand } from "./commands/sync.js";
import { registerRecallCommand } from "./commands/recall.js";
import { registerDoctorCommand } from "./commands/doctor.js";

program
  .name("brv-claude-plugin")
  .description(
    "Native bridge between ByteRover context engine and Claude Code auto-memory",
  )
  .version("0.1.0");

registerInstallCommand(program);
registerUninstallCommand(program);
registerIngestCommand(program);
registerSyncCommand(program);
registerRecallCommand(program);
registerDoctorCommand(program);

program.parse();
