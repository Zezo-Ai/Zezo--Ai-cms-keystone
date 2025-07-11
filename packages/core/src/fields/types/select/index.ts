import { classify } from 'inflection'
import { humanize } from '../../../lib/utils'
import type { SimpleFieldTypeInfo } from '../../../types'
import {
  type BaseListTypeInfo,
  type CommonFieldConfig,
  type FieldTypeFunc,
  fieldType,
  orderDirectionEnum,
} from '../../../types'
import { g } from '../../..'
import { filters } from '../../filters'
import { makeValidateHook, defaultIsRequired } from '../../non-null-graphql'
import type { controller } from './views'

export type SelectFieldConfig<ListTypeInfo extends BaseListTypeInfo> = CommonFieldConfig<
  ListTypeInfo,
  SimpleFieldTypeInfo<'String' | 'Int'>
> &
  (
    | {
        /**
         * When a value is provided as just a string, it will be formatted in the same way
         * as field labels are to create the label.
         */
        options: readonly ({ label: string; value: string } | string)[]
        /**
         * If `enum` is provided on SQLite, it will use an enum in GraphQL but a string in the database.
         */
        type?: 'string' | 'enum'
        defaultValue?: string
      }
    | {
        options: readonly { label: string; value: number }[]
        type: 'integer'
        defaultValue?: number
      }
  ) & {
    ui?: {
      displayMode?: 'select' | 'segmented-control' | 'radio'
    }

    validation?: {
      /**
       * @default false
       */
      isRequired?: boolean
    }
    isIndexed?: boolean | 'unique'
    db?: {
      isNullable?: boolean
      map?: string
      extendPrismaSchema?: (field: string) => string
    }
  }

// these are the lowest and highest values for a signed 32-bit integer
const MAX_INT = 2147483647
const MIN_INT = -2147483648

export function select<ListTypeInfo extends BaseListTypeInfo>(
  config: SelectFieldConfig<ListTypeInfo>
): FieldTypeFunc<ListTypeInfo> {
  const { isIndexed, ui: { displayMode = 'select', ...ui } = {}, defaultValue, validation } = config

  return meta => {
    const options = config.options.map(option => {
      if (typeof option === 'string') {
        return {
          label: humanize(option),
          value: option,
        }
      }
      return option
    })

    const accepted = new Set(options.map(x => x.value))
    if (accepted.size !== options.length) {
      throw new Error(`${meta.listKey}.${meta.fieldKey}: duplicate options, this is not allowed`)
    }

    const { mode, validate } = makeValidateHook(
      meta,
      config,
      ({ resolvedData, operation, addValidationError }) => {
        if (operation === 'delete') return

        const value = resolvedData[meta.fieldKey]
        if (value != null && !accepted.has(value)) {
          addValidationError(`value is not an accepted option`)
        }
      }
    )

    const commonConfig = {
      ...config,
      mode,
      ...defaultIsRequired({ ui }, validation?.isRequired ?? false),
      hooks: {
        ...config.hooks,
        validate,
      },
      __ksTelemetryFieldTypeName: '@keystone-6/select',
      views: '@keystone-6/core/fields/types/select/views',
      getAdminMeta: (): Parameters<typeof controller>[0]['fieldMeta'] => ({
        options,
        type: config.type ?? 'string',
        displayMode: displayMode,
        defaultValue: defaultValue ?? null,
      }),
    }

    const commonDbFieldConfig = {
      mode,
      index: isIndexed === true ? 'index' : isIndexed || undefined,
      default:
        defaultValue === undefined
          ? undefined
          : { kind: 'literal' as const, value: defaultValue as any },
      map: config.db?.map,
      extendPrismaSchema: config.db?.extendPrismaSchema,
    } as const

    const resolveCreate = <T extends string | number>(val: T | null | undefined): T | null => {
      if (val === undefined) {
        return (defaultValue as T | undefined) ?? null
      }
      return val
    }

    if (config.type === 'integer') {
      if (
        config.options.some(
          ({ value }) => !Number.isInteger(value) || value > MAX_INT || value < MIN_INT
        )
      ) {
        throw new Error(
          `${meta.listKey}.${meta.fieldKey} specifies integer values that are outside the range of a 32-bit signed integer`
        )
      }
      return fieldType({
        kind: 'scalar',
        scalar: 'Int',
        ...commonDbFieldConfig,
      })({
        ...commonConfig,
        input: {
          uniqueWhere: isIndexed === 'unique' ? { arg: g.arg({ type: g.Int }) } : undefined,
          where: {
            arg: g.arg({ type: filters[meta.provider].Int[mode] }),
            resolve: mode === 'required' ? undefined : filters.resolveCommon,
          },
          create: {
            arg: g.arg({
              type: g.Int,
              defaultValue: typeof defaultValue === 'number' ? defaultValue : undefined,
            }),
            resolve: resolveCreate,
          },
          update: { arg: g.arg({ type: g.Int }) },
          orderBy: { arg: g.arg({ type: orderDirectionEnum }) },
        },
        output: g.field({ type: g.Int }),
      })
    }

    if (config.type === 'enum') {
      const enumName = `${meta.listKey}${classify(meta.fieldKey)}Type`
      const enumValues = options.map(x => `${x.value}`)

      const graphQLType = g.enum({
        name: enumName,
        values: g.enumValues(enumValues),
      })
      return fieldType(
        meta.provider === 'sqlite'
          ? { kind: 'scalar', scalar: 'String', ...commonDbFieldConfig }
          : {
              kind: 'enum',
              values: enumValues,
              name: enumName,
              ...commonDbFieldConfig,
            }
      )({
        ...commonConfig,
        input: {
          uniqueWhere: isIndexed === 'unique' ? { arg: g.arg({ type: graphQLType }) } : undefined,
          where: {
            arg: g.arg({ type: filters[meta.provider].enum(graphQLType).optional }),
            resolve: mode === 'required' ? undefined : filters.resolveCommon,
          },
          create: {
            arg: g.arg({
              type: graphQLType,
              defaultValue: typeof defaultValue === 'string' ? defaultValue : undefined,
            }),
            resolve: resolveCreate,
          },
          update: { arg: g.arg({ type: graphQLType }) },
          orderBy: { arg: g.arg({ type: orderDirectionEnum }) },
        },
        output: g.field({ type: graphQLType }),
      })
    }

    return fieldType({ kind: 'scalar', scalar: 'String', ...commonDbFieldConfig })({
      ...commonConfig,
      input: {
        uniqueWhere: isIndexed === 'unique' ? { arg: g.arg({ type: g.String }) } : undefined,
        where: {
          arg: g.arg({ type: filters[meta.provider].String[mode] }),
          resolve: mode === 'required' ? undefined : filters.resolveString,
        },
        create: {
          arg: g.arg({
            type: g.String,
            defaultValue: typeof defaultValue === 'string' ? defaultValue : undefined,
          }),
          resolve: resolveCreate,
        },
        update: { arg: g.arg({ type: g.String }) },
        orderBy: { arg: g.arg({ type: orderDirectionEnum }) },
      },
      output: g.field({ type: g.String }),
    })
  }
}
