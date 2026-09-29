import { resetPreviewBranch } from "@/db/preview-branch";

// Runs first in every build (vercel.ts). Only preview builds touch the database; see docs/deploy.md.
const result = await resetPreviewBranch();
console.log(
  result === "reset"
    ? "Restored the preview database branch from seed"
    : "Not a preview build; database branch left alone",
);
