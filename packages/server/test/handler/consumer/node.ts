import { create } from "@bufbuild/protobuf";
import { AppQueryHandler, type AppQueryContext } from "../../../dist/index.js";
import { GetProjectOverview } from "../../../test-fixtures/generated/repository-routing/project_queries_app_query.js";

export class Overview extends AppQueryHandler<
  GetProjectOverview.Query,
  GetProjectOverview.Response
> {
  execute(
    _query: GetProjectOverview.Query,
    _context: AppQueryContext,
  ): GetProjectOverview.Response {
    void _query;
    void _context;
    return create(GetProjectOverview.responseSchema);
  }
}
