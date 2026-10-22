// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  getDeletedModels,
  getDeletedByProvider,
  deleteOfficialModels,
  restoreOfficialModels,
} from "@/lib/db/index.js";
