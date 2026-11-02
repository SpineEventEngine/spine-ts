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

import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { BrowserSession, Client, type ClientRequest } from "@spine-event-engine/client-web";
import { AuthenticationService, ResolveContextRequestSchema } from "@spine-event-engine/proto/auth";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import { MessageBoardApp } from "./index.js";

interface ActiveReader {
  readonly actor: string;
  readonly client: Client;
  readonly request: ClientRequest;
  readonly session: BrowserSession;
  readonly generation: number;
}

interface SignedReaderState {
  readonly token: string;
  readonly active: ActiveReader | undefined;
  readonly error: string | undefined;
  readonly validating: boolean;
  readonly board: string;
  readonly setBoard: (board: string) => void;
  readonly setToken: (token: string) => void;
  readonly connect: () => void;
  readonly signOut: () => void;
}

interface SessionControls {
  readonly setActive: (reader: ActiveReader | undefined) => void;
  readonly setBoard: (board: string) => void;
  readonly setToken: (token: string) => void;
  readonly setError: (error: string | undefined) => void;
  readonly setValidating: (validating: boolean) => void;
  readonly generation: React.RefObject<number>;
  readonly pending: React.RefObject<BrowserSession | undefined>;
}

const SessionConnections = Object.freeze({
  /**
   * Resolves verified actor context through the existing Gateway authentication service.
   *
   * @param url Selects the Gateway.
   * @param session Supplies the bearer credential.
   * @returns The verified actor identifier.
   */
  async actor(url: string, session: BrowserSession): Promise<string> {
    const transport = createConnectTransport({ baseUrl: url, useBinaryFormat: true });
    const authentication = createClient(AuthenticationService, transport);
    await session.reauthenticate(async ({ signal }) => {
      const result = await authentication.resolveContext(create(ResolveContextRequestSchema), {
        headers: session.requestMetadata(),
        signal,
      });
      return {
        ...(result.actor === undefined ? {} : { actor: result.actor.value }),
        ...(result.tenant?.kind.case === "value" ? { tenant: result.tenant.kind.value } : {}),
        ...(result.expiresAt === undefined ? {} : { expiresAt: timestampDate(result.expiresAt) }),
      };
    });
    const actor = session.context?.actor;
    if (actor === undefined || actor.length === 0) throw new Error("Session has no actor.");
    return actor;
  },

  /**
   * Creates the active reader from a validated bearer session.
   *
   * @param url Selects the Gateway.
   * @param session Carries the verified credential.
   * @param actor Identifies the verified principal.
   * @param generation Fences the active reader.
   * @returns The configured client and reader request.
   */
  reader(url: string, session: BrowserSession, actor: string, generation: number): ActiveReader {
    const client = Client.forConnect(url, {
      credentials: session.credentials,
      onRequestMetadata: () => session.requestMetadata(),
    });
    return { actor, client, request: client.onBehalfOf(actor), session, generation };
  },

  /**
   * Cancels stale validation and activates only the latest verified reader.
   *
   * @param url Selects the Gateway.
   * @param token Supplies an issued bearer credential.
   * @param state Tracks the latest attempt and reader.
   * @returns Completion of credential validation.
   */
  async connect(url: string, token: string, state: SessionControls): Promise<void> {
    const attempt = ++state.generation.current;
    void state.pending.current?.close();
    state.setActive(undefined);
    state.setValidating(true);
    state.setError(undefined);
    let session: BrowserSession | undefined;
    let admitted = false;
    try {
      session = BrowserSession.bearer({ token });
      state.pending.current = session;
      const actor = await SessionConnections.actor(url, session);
      if (attempt !== state.generation.current) return;
      state.setActive(SessionConnections.reader(url, session, actor, attempt));
      admitted = true;
      state.setBoard("general");
      state.setToken("");
    } catch (reason) {
      console.warn("Message Board credential validation failed.", reason);
      if (attempt === state.generation.current)
        state.setError("Credential is invalid or the session is unavailable.");
    } finally {
      if (!admitted || attempt !== state.generation.current) await session?.close();
      if (attempt === state.generation.current) {
        if (state.pending.current === session) state.pending.current = undefined;
        state.setValidating(false);
      }
    }
  },
});

const useSessionCleanup = (
  active: ActiveReader | undefined,
  generation: React.RefObject<number>,
  pending: React.RefObject<BrowserSession | undefined>,
) => {
  useEffect(
    () => () => {
      generation.current += 1;
      void pending.current?.close();
      pending.current = undefined;
    },
    [generation, pending],
  );
  useEffect(
    () => () => {
      if (active !== undefined)
        void (async () => {
          try {
            await active.client.close();
          } finally {
            await active.session.close();
          }
        })();
    },
    [active],
  );
};

const useSignedReader = (url: string): SignedReaderState => {
  const [token, setToken] = useState("");
  const [active, setActive] = useState<ActiveReader>();
  const [error, setError] = useState<string>();
  const [validating, setValidating] = useState(false);
  const [board, setBoard] = useState("general");
  const generation = useRef(0);
  const pending = useRef<BrowserSession | undefined>(undefined);
  useSessionCleanup(active, generation, pending);
  const controls = { setActive, setBoard, setToken, setError, setValidating, generation, pending };
  const connect = () => {
    void SessionConnections.connect(url, token, controls);
  };
  const signOut = () => {
    generation.current += 1;
    void pending.current?.close();
    pending.current = undefined;
    setActive(undefined);
    setToken("");
    setValidating(false);
  };
  return { token, active, error, validating, board, setBoard, setToken, connect, signOut };
};

/**
 * Renders public admission or validates a bearer session before mounting board readers.
 *
 * @param props Selects the Gateway and admission mode.
 * @returns The credential form and active board reader.
 */
export const SessionBoardApp = (props: {
  readonly url: string;
  readonly mode: "public" | "signed";
}): ReactElement => {
  if (props.mode === "public") return <PublicBoard url={props.url} />;
  return <SignedBoard url={props.url} />;
};

const SignedBoard = ({ url }: { readonly url: string }): ReactElement => {
  const state = useSignedReader(url);
  return (
    <>
      <CredentialForm state={state} />
      {state.active === undefined ? (
        <p>Enter an issued credential to read the board.</p>
      ) : (
        <ActiveBoard state={state} active={state.active} />
      )}
    </>
  );
};

const CredentialForm = ({ state }: { readonly state: SignedReaderState }): ReactElement => (
  <form
    onSubmit={(event) => {
      event.preventDefault();
      state.connect();
    }}
  >
    <label htmlFor="board-credential">Issued bearer credential</label>
    <input
      id="board-credential"
      type="password"
      autoComplete="off"
      value={state.token}
      onChange={(event) => state.setToken(event.target.value)}
    />
    <button type="submit" disabled={state.validating || state.token.length === 0}>
      Use credential
    </button>
    {state.error === undefined ? null : <p role="alert">{state.error}</p>}
  </form>
);

const ActiveBoard = ({
  state,
  active,
}: {
  readonly state: SignedReaderState;
  readonly active: ActiveReader;
}): ReactElement => (
  <>
    <p>Signed in as {active.actor}</p>
    <button type="button" onClick={state.signOut}>
      Sign out
    </button>
    <BoardSelector board={state.board} onChange={state.setBoard} />
    <MessageBoardApp
      key={`${active.generation}-${state.board}`}
      actor={active.actor}
      board={state.board}
      request={active.request}
    />
  </>
);

const PublicBoard = (props: { readonly url: string }): ReactElement => {
  const [client] = useState(() => Client.forConnect(props.url));
  const [board, setBoard] = useState("general");
  const request = useMemo(() => client.onBehalfOf("ada"), [client]);
  useEffect(
    () => () => {
      void client.close();
    },
    [client],
  );
  return (
    <>
      <p>Public reader: author names are hidden in board results.</p>
      <BoardSelector board={board} onChange={setBoard} />
      <MessageBoardApp key={board} actor="ada" board={board} request={request} />
    </>
  );
};

const BoardSelector = (props: {
  readonly board: string;
  readonly onChange: (board: string) => void;
}): ReactElement => {
  return (
    <label>
      Board{" "}
      <select
        aria-label="Board"
        value={props.board}
        onChange={(event) => props.onChange(event.target.value)}
      >
        <option value="general">General</option>
        <option value="announcements">Announcements</option>
        <option value="restricted">Restricted</option>
      </select>
    </label>
  );
};
