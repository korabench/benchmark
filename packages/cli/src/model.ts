import {ModelRequest, TypedModelRequest} from "@korabench/core";

export interface Model {
  getTextResponse(request: ModelRequest): Promise<string>;
  getStructuredResponse<T>(request: TypedModelRequest<T>): Promise<T>;
}
