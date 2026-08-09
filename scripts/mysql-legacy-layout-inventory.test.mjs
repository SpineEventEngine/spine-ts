import { describe, expect, it, vi } from "vitest";

import {
  inspectMysqlUrl,
  mysqlInventoryUrls,
  mysqlLegacyFindings,
} from "../packages/storage-rdbms/scripts/inventory-legacy-layout.mjs";

describe("MySQL legacy-layout inventory", () => {
  it("reports invented columns and compound scope keys", () => {
    expect(
      mysqlLegacyFindings(
        [
          { table_name: "messages", column_name: "_scope" },
          { table_name: "messages", column_name: "_revision" },
        ],
        [
          { table_name: "messages", column_name: "_scope", seq_in_index: 1 },
          { table_name: "messages", column_name: "ID", seq_in_index: 2 },
        ],
      ),
    ).toEqual(["messages.PRIMARY(_scope)", "messages._revision", "messages._scope"]);
  });

  it("accepts corrected direct-ID tables", () => {
    expect(
      mysqlLegacyFindings([], [{ table_name: "messages", column_name: "ID", seq_in_index: 1 }]),
    ).toEqual([]);
  });

  it("closes the inspected pool after success or failure", async () => {
    const end = vi.fn(() => Promise.resolve());
    const query = vi
      .fn()
      .mockResolvedValueOnce([[{ table_name: "messages", column_name: "_scope" }]])
      .mockRejectedValueOnce(new Error("statistics unavailable"));
    await expect(inspectMysqlUrl("mysql://example", () => ({ query, end }))).rejects.toThrow(
      "statistics unavailable",
    );
    expect(end).toHaveBeenCalledExactlyOnceWith();
  });

  it("requires explicit targets and accepts repeated URLs", () => {
    expect(mysqlInventoryUrls(["--url", "mysql://a", "--url", "mysql://b"], {})).toEqual([
      "mysql://a",
      "mysql://b",
    ]);
    expect(() => mysqlInventoryUrls([], {})).toThrow("Provide at least one");
  });
});
