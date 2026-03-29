import { ReactNode } from 'react';
import { TextInput, Textarea } from '@mantine/core';
import { DateTimePicker, DatePickerInput } from '@mantine/dates';

export type ColumnInputKind = 'datetime' | 'date' | 'textarea' | 'default';

export function getColumnInputKind(dataType: string): ColumnInputKind {
  const dt = dataType.toLowerCase().trim();

  // Strip type parameters e.g. "timestamp(6)" → "timestamp"
  const base = dt.replace(/\(.*\)/, '').trim();

  if (
    base === 'timestamp' ||
    base === 'datetime' ||
    base === 'timestamptz' ||
    base === 'timestamp without time zone' ||
    base === 'timestamp with time zone'
  ) {
    return 'datetime';
  }

  if (base === 'date') {
    return 'date';
  }

  if (
    base === 'text' ||
    base === 'longtext' ||
    base === 'mediumtext' ||
    base === 'tinytext' ||
    base === 'json' ||
    base === 'jsonb'
  ) {
    return 'textarea';
  }

  return 'default';
}

const inputStyles = {
  input: {
    fontFamily: 'monospace',
    fontSize: 'var(--mantine-font-size-sm)',
  },
};

interface SmartColumnInputProps {
  dataType: string;
  value: string;
  onChange: (value: string) => void;
  label: ReactNode;
  placeholder?: string;
  description?: ReactNode;
  disabled?: boolean;
  withAsterisk?: boolean;
  error?: ReactNode;
  /** Used only for 'default' fallback — forces multiline Textarea */
  forceMultiline?: boolean;
  inputRef?: React.Ref<HTMLInputElement | HTMLTextAreaElement>;
}

export function SmartColumnInput({
  dataType,
  value,
  onChange,
  label,
  placeholder,
  description,
  disabled,
  withAsterisk,
  error,
  forceMultiline,
  inputRef,
}: SmartColumnInputProps) {
  const kind = getColumnInputKind(dataType);

  if (kind === 'datetime') {
    return (
      <DateTimePicker
        label={label}
        placeholder={placeholder}
        description={description}
        value={value || null}
        onChange={(val) => onChange(val ?? '')}
        withSeconds
        clearable
        disabled={disabled}
        withAsterisk={withAsterisk}
        error={error}
        valueFormat="YYYY-MM-DD HH:mm:ss"
        styles={inputStyles}
      />
    );
  }

  if (kind === 'date') {
    return (
      <DatePickerInput
        label={label}
        placeholder="Pick date"
        description={description}
        value={value || null}
        onChange={(val) => onChange(val ?? '')}
        clearable
        disabled={disabled}
        withAsterisk={withAsterisk}
        error={error}
        valueFormat="YYYY-MM-DD"
        styles={inputStyles}
      />
    );
  }

  if (kind === 'textarea' || forceMultiline) {
    return (
      <Textarea
        label={label}
        placeholder={placeholder}
        description={description}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        minRows={3}
        maxRows={6}
        autosize
        disabled={disabled}
        withAsterisk={withAsterisk}
        error={error}
        styles={inputStyles}
        ref={inputRef as React.Ref<HTMLTextAreaElement>}
      />
    );
  }

  return (
    <TextInput
      label={label}
      placeholder={placeholder}
      description={description}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      disabled={disabled}
      withAsterisk={withAsterisk}
      error={error}
      styles={inputStyles}
      ref={inputRef as React.Ref<HTMLInputElement>}
    />
  );
}
