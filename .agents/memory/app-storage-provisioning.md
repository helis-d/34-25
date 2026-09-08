---
name: App Storage provisioning
description: Environment-specific behavior when enabling persistent media storage for web apps.
---

App Storage setup may briefly return an internal bucket-creation error even when the workspace can provision the bucket successfully moments later. Retry the idempotent setup operation before falling back to a different storage design.

**Why:** 3425’s first setup attempt failed, while a second attempt created the bucket and exposed the expected environment variables.

**How to apply:** When a web app requires persistent uploads, keep the presigned upload architecture and retry provisioning once before treating storage as unavailable.