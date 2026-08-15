/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Marks the first parameter of a generated event receptor as accepting an
 * event imported from another bounded context.
 *
 * This is deliberately a transparent type-only marker. The build-time handler
 * analyzer records it in generated metadata; no runtime value or registration
 * API is introduced.
 */
export type External<Value> = Value;
