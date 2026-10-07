/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import type { AgentAi } from "@spine-event-engine/ai";

const bindings = new WeakMap<object, AgentAi>();

interface AgentAiBindingAccess {
  /**
   * Attaches one handler-scoped facade and returns its release.
   * @param agent Active Agent instance receiving the facade.
   * @param ai Fenced facade for this handler invocation.
   * @returns Callback that releases this exact binding.
   */
  bind(agent: object, ai: AgentAi): () => void;

  /**
   * Returns the facade attached to the active handler.
   * @param agent Active Agent instance whose binding is required.
   * @returns Handler-scoped facade or throws when none is bound.
   */
  require(agent: object): AgentAi;
}

/**
 * Binds the protected Agent AI facade only during one selected handler scope.
 */
export const AgentAiBindings: AgentAiBindingAccess = Object.freeze({
  /**
   * Attaches a facade and returns an idempotent release operation.
   * @param agent Active Agent instance.
   * @param ai Fenced invocation facade.
   * @returns Release of this exact binding.
   */
  bind(agent: object, ai: AgentAi): () => void {
    if (bindings.has(agent)) throw new Error("Agent AI is already bound to an active handler.");
    bindings.set(agent, ai);
    return () => {
      if (bindings.get(agent) === ai) bindings.delete(agent);
    };
  },

  /**
   * Returns the facade scoped to this handler.
   * @param agent Active Agent instance.
   * @returns Fenced Agent AI operations.
   */
  require(agent: object): AgentAi {
    const ai = bindings.get(agent);
    if (ai === undefined) throw new Error("Agent AI is available only during a signal handler.");
    return ai;
  },
});
