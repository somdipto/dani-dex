// Slug to guide body, on the same terms as the news bodies: eager, so the prose
// is in the server's HTML rather than arriving after hydration.

import type { ArticleBody } from "../body";
import { DaniDex101 } from "./openbot-101";
import { WriteAGuideForDaniDex } from "./write-a-guide-for-openbot";
import { WtfIsDaniDex } from "./wtf-is-openbot";

export const GUIDE_BODIES: Readonly<Record<string, ArticleBody>> = {
  "openbot-101": DaniDex101,
  "write-a-guide-for-openbot": WriteAGuideForDaniDex,
  "wtf-is-openbot": WtfIsDaniDex,
};
