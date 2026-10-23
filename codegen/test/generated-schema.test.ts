import { expect, test } from "vitest";

import { zActivityTypeDto } from "../../src/garmin-api/zod.gen.ts";

test("generated activity schemas retain Garmin extensions", () => {
  const activity = {
    typeId: 17,
    typeKey: "running",
    vendorField: "preserved",
  };

  expect(zActivityTypeDto.parse(activity)).toEqual(activity);
});
