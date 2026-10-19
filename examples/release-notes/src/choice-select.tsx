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

import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactElement } from "react";

interface Choice {
  readonly value: string;
  readonly label: string;
}

interface ChoiceSelectProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly Choice[];
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
}

const ChoiceItems = ({ options }: { options: readonly Choice[] }) => (
  <Select.Viewport className="choice-viewport">
    {options.map((option) => (
      <Select.Item className="choice-item" key={option.value} value={option.value}>
        <Select.ItemText>{option.label}</Select.ItemText>
        <Select.ItemIndicator className="choice-indicator">
          <Check aria-hidden="true" size={15} />
        </Select.ItemIndicator>
      </Select.Item>
    ))}
  </Select.Viewport>
);

const ChoiceTrigger = ({
  label,
  placeholder,
  title,
}: {
  label: string;
  placeholder: string;
  title: string | undefined;
}) => (
  <Select.Trigger className="choice-trigger" aria-label={label} title={title}>
    <span className="choice-current">
      <Select.Value placeholder={placeholder} />
    </span>
    <Select.Icon className="choice-icon">
      <ChevronDown aria-hidden="true" size={16} />
    </Select.Icon>
  </Select.Trigger>
);

const ChoiceMenu = ({ options }: { options: readonly Choice[] }) => (
  <Select.Portal>
    <Select.Content className="choice-menu" position="popper" sideOffset={5} collisionPadding={8}>
      <ChoiceItems options={options} />
    </Select.Content>
  </Select.Portal>
);

/**
 * Creates a keyboard-accessible menu with full option text.
 *
 * @param label Accessible name and visible field label.
 * @param value Currently selected option value.
 * @param options Choices displayed by the menu.
 * @param placeholder Text shown without a current choice.
 * @param onChange Called when the choice changes.
 * @param disabled Whether the menu is unavailable.
 * @returns The labelled selection control.
 */
export const ChoiceSelect = ({
  label,
  value,
  options,
  placeholder,
  onChange,
  disabled,
}: ChoiceSelectProps): ReactElement => {
  const selected = options.find((option) => option.value === value);
  return (
    <label className="choice-field">
      {label}
      <Select.Root
        value={selected?.value ?? ""}
        onValueChange={onChange}
        disabled={disabled ?? false}
      >
        <ChoiceTrigger label={label} placeholder={placeholder} title={selected?.label} />
        <ChoiceMenu options={options} />
      </Select.Root>
    </label>
  );
};
