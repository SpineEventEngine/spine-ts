import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import { MysqlStorageFactory, type MysqlStorageFactoryBuilder } from "../src/index.js";

describe("MysqlStorageFactory builder contract", () => {
  it("exposes the JVM-style builder without a static create alias", () => {
    const builder: MysqlStorageFactoryBuilder = MysqlStorageFactory.newBuilder();

    expect(builder.setTableName(StringValueSchema, "records")).toBe(builder);
    expect("create" in MysqlStorageFactory).toBe(false);
  });
});
