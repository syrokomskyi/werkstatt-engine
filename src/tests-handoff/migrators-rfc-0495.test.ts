/*
<MODULE_CONTRACT>
<purpose>RFC-0495: idempotency and no-op tests for the rfc-0495 migrator.</purpose>
<keywords>RFC-0495, migrator, idempotency, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0495: initial idempotency and no-op tests for rfc-0495 migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { rfc0495Migrator } from "../migrators/rfc-0495.ts";
import type { SternsystemData, MigrationContext } from "../migrators/types.ts";

const mockCtx: MigrationContext = {
  systemId: "test-system",
  missionId: "test-mission",
  logger: { info: () => {} },
};

const mockData: SternsystemData = {
  rootPath: "/tmp/test-rfc-0495",
  dataPaths: [],
};

test("rfc-0495 migrator is registered with correct id", () => {
  expect(rfc0495Migrator.id).toBe("rfc-0495");
});

test("rfc-0495 migrator is a no-op — returns data unchanged", async () => {
  const result = await rfc0495Migrator.transform(mockData, mockCtx);
  expect(result).toBe(mockData);
});

test("rfc-0495 migrator is idempotent — f(f(x)) === f(x)", async () => {
  const once = await rfc0495Migrator.transform(mockData, mockCtx);
  const twice = await rfc0495Migrator.transform(once, mockCtx);
  expect(twice).toEqual(once);
});
