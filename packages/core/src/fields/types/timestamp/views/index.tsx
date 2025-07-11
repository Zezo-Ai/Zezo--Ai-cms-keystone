import { getLocalTimeZone, now, parseAbsoluteToLocal } from '@internationalized/date'
import { useDateFormatter } from '@react-aria/i18n'
import { useReducer, useState } from 'react'

import { ToggleButton } from '@keystar/ui/button'
import { DatePicker } from '@keystar/ui/date-time'
import { Icon } from '@keystar/ui/icon'
import { calendarClockIcon } from '@keystar/ui/icon/icons/calendarClockIcon'
import { Grid } from '@keystar/ui/layout'
import { TextField } from '@keystar/ui/text-field'
import { TooltipTrigger, Tooltip } from '@keystar/ui/tooltip'
import { Text } from '@keystar/ui/typography'

import type {
  CellComponent,
  FieldController,
  FieldControllerConfig,
  FieldProps,
  SimpleFieldTypeInfo,
} from '../../../../types'
import { entriesTyped } from '../../../../lib/core/utils'
import type { Value } from './utils'

export function Field(props: FieldProps<typeof controller>) {
  const { field, value, forceValidation, onChange, isRequired } = props
  const parsedValue = value.value ? parseAbsoluteToLocal(value.value) : null

  const [isDirty, setDirty] = useState(false)
  const [isReadonlyUTC, toggleReadonlyUTC] = useReducer(prev => !prev, false)
  const dateFormatter = useDateFormatter({ dateStyle: 'long', timeStyle: 'long' })

  // the read-only date field is deceptively interactive, better to render a
  // text field to avoid confusion. when there's no value the field is disabled,
  // placeholder text is shown, and the toggle button is hidden
  if (!onChange) {
    return (
      <Grid
        columns={parsedValue ? 'minmax(0, 1fr) auto' : undefined}
        gap="regular"
        alignItems="end"
      >
        <TextField
          label={field.label}
          description={field.description}
          isDisabled={!parsedValue}
          isReadOnly
          value={
            parsedValue
              ? isReadonlyUTC
                ? parsedValue.toAbsoluteString()
                : dateFormatter.format(parsedValue.toDate())
              : 'yyyy-mm-dd --:--:--'
          }
        />
        {!!parsedValue && (
          <TooltipTrigger>
            <ToggleButton
              aria-label="utc time"
              isSelected={isReadonlyUTC}
              onPress={toggleReadonlyUTC}
            >
              <Icon src={calendarClockIcon} />
            </ToggleButton>
            <Tooltip>Local / UTC</Tooltip>
          </TooltipTrigger>
        )}
      </Grid>
    )
  }

  const showValidation = isDirty || forceValidation
  const validationMessage = showValidation
    ? validate(value, field.fieldMeta, isRequired, field.label)
    : undefined

  return (
    <DatePicker
      label={field.label}
      description={field.description}
      errorMessage={showValidation ? validationMessage : undefined}
      granularity="second"
      // isReadOnly={undefined} // read-only state handled above
      isRequired={isRequired}
      // NOTE: in addition to providing a cue for users about the expected input
      // format, the `placeholderValue` determines the type of value for the
      // field. the implementation below ensures `ZonedDateTime` so we can avoid
      // unnecessary guards or transformations.
      placeholderValue={now(getLocalTimeZone())}
      onBlur={() => setDirty(true)}
      onChange={datetime => {
        onChange({ ...value, value: datetime?.toAbsoluteString() ?? null })
      }}
      value={parsedValue}
    />
  )
}

function validate(
  value: Value,
  fieldMeta: TimestampFieldMeta,
  isRequired: boolean,
  label: string
): string | undefined {
  const isEmpty = !value.value

  // if we recieve null initially on the item view and the current value is null,
  // we should always allow saving it because:
  // - the value might be null in the database and we don't want to prevent saving the whole item because of that
  // - we might have null because of an access control error
  if (value.kind === 'update' && value.initial === null && isEmpty) return

  if (
    value.kind === 'create' &&
    isEmpty &&
    ((typeof fieldMeta.defaultValue === 'object' && fieldMeta.defaultValue?.kind === 'now') ||
      fieldMeta.updatedAt)
  )
    return

  if (isRequired && isEmpty) return `${label} is required`

  // TODO: update field in "@keystar/ui" to use new validation APIs, for more
  // granular validation messages
  return
}

export const Cell: CellComponent<typeof controller> = ({ value }) => {
  const dateFormatter = useDateFormatter({ dateStyle: 'medium', timeStyle: 'short' })
  return value ? <Text>{dateFormatter.format(new Date(value))}</Text> : null
}

export type TimestampFieldMeta = {
  defaultValue: string | { kind: 'now' } | null
  updatedAt: boolean
}

export function controller(config: FieldControllerConfig<TimestampFieldMeta>): FieldController<
  Value,
  string | null,
  SimpleFieldTypeInfo<'DateTime'>['inputs']['where']
> & {
  fieldMeta: TimestampFieldMeta
} {
  return {
    path: config.path,
    label: config.label,
    description: config.description,
    graphqlSelection: config.path,
    fieldMeta: config.fieldMeta,
    defaultValue: {
      kind: 'create',
      value:
        typeof config.fieldMeta.defaultValue === 'string' ? config.fieldMeta.defaultValue : null,
    },
    deserialize: data => {
      const value = data[config.path]
      return {
        kind: 'update',
        initial: data[config.path],
        value: value ?? null,
      }
    },
    serialize: ({ value }) => {
      if (value) return { [config.path]: value }
      return { [config.path]: null }
    },
    validate: (value, opts) =>
      validate(value, config.fieldMeta, opts.isRequired, config.label) === undefined,
    filter: {
      Filter(props) {
        const {
          autoFocus,
          context,
          forceValidation,
          typeLabel,
          onChange,
          value,
          type,
          ...otherProps
        } = props
        const [isDirty, setDirty] = useState(false)

        if (type === 'empty' || type === 'not_empty') return null
        const parsedValue = value ? parseAbsoluteToLocal(value) : null

        return (
          <DatePicker
            label={typeLabel}
            granularity="second"
            placeholderValue={now(getLocalTimeZone())}
            errorMessage={(forceValidation || isDirty) && !value ? 'Required' : null}
            isRequired
            hideTimeZone
            onBlur={() => setDirty(true)}
            onChange={datetime => {
              onChange(datetime?.toAbsoluteString() ?? null)
            }}
            value={parsedValue}
            {...otherProps}
          />
        )
      },
      graphql: ({ type, value }) => {
        if (type === 'empty') return { [config.path]: { equals: null } }
        if (type === 'not_empty') return { [config.path]: { not: { equals: null } } }
        if (type === 'not') return { [config.path]: { not: { equals: value } } }
        return { [config.path]: { [type]: value } }
      },
      parseGraphQL: value => {
        return entriesTyped(value).flatMap(([type, value]) => {
          if (type === 'equals' && value === null) {
            return { type: 'empty', value: null }
          }
          if (!value) return []
          if (type === 'equals') return { type: 'equals', value: value as unknown as string }
          if (type === 'not') {
            if (value?.equals === null) return { type: 'not_empty', value: null }
            return { type: 'not', value: value.equals as unknown as string }
          }
          if (type === 'gt' || type === 'lt') {
            return { type, value: value as unknown as string }
          }
          return []
        })
      },
      Label({ label, type, value }) {
        const dateFormatter = useDateFormatter({ dateStyle: 'short', timeStyle: 'short' })
        if (type === 'empty' || type === 'not_empty' || value == null) {
          return label.toLocaleLowerCase()
        }

        return `${label.toLocaleLowerCase()} ${dateFormatter.format(new Date(value))}`
      },
      types: {
        equals: {
          label: 'Is exactly',
          initialValue: null,
        },
        not: {
          label: 'Is not exactly',
          initialValue: null,
        },
        lt: {
          label: 'Is before',
          initialValue: null,
        },
        gt: {
          label: 'Is after',
          initialValue: null,
        },
        empty: {
          label: 'Is empty',
          initialValue: null,
        },
        not_empty: {
          label: 'Is not empty',
          initialValue: null,
        },
      },
    },
  }
}
