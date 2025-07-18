import { gen, sampleOne } from 'testcheck'
import { text, relationship } from '@keystone-6/core/fields'
import { list } from '@keystone-6/core'
import { setupTestRunner } from '@keystone-6/api-tests/test-runner'
import { allOperations, allowAll } from '@keystone-6/core/access'
import { expectSingleRelationshipError } from '../../utils'

const alphanumGenerator = gen.alphaNumString.notEmpty()

type IdType = any

const runner = setupTestRunner({
  config: {
    lists: {
      Note: list({
        access: allowAll,
        fields: {
          content: text(),
        },
      }),
      User: list({
        access: allowAll,
        fields: {
          username: text(),
          notes: relationship({ ref: 'Note', many: true }),
        },
      }),
      NoteNoRead: list({
        access: {
          operation: { ...allOperations(allowAll), query: () => false },
        },
        fields: {
          content: text(),
        },
      }),
      UserToNotesNoRead: list({
        access: allowAll,
        fields: {
          username: text(),
          notes: relationship({ ref: 'NoteNoRead', many: true }),
        },
      }),
      NoteNoCreate: list({
        access: {
          operation: { ...allOperations(allowAll), create: () => false },
        },
        fields: {
          content: text(),
        },
      }),
      UserToNotesNoCreate: list({
        access: allowAll,
        fields: {
          username: text(),
          notes: relationship({ ref: 'NoteNoCreate', many: true }),
        },
      }),
    },
  },
})

describe('no access control', () => {
  test(
    'link AND create nested from within create mutation',
    runner(async ({ context }) => {
      const noteContent = sampleOne(alphanumGenerator)
      const noteContent2 = sampleOne(alphanumGenerator)

      // Create an item to link against
      const createNote = await context.query.Note.createOne({ data: { content: noteContent } })

      // Create an item that does the linking
      type T = { id: IdType; notes: { id: IdType; content: string }[] }
      const user = (await context.query.User.createOne({
        data: {
          username: 'A thing',
          notes: { connect: [{ id: createNote.id }], create: [{ content: noteContent2 }] },
        },
        query: 'id notes { id content }',
      })) as T

      expect(user).toMatchObject({
        id: expect.any(String),
        notes: [
          { id: expect.any(String), content: noteContent },
          { id: expect.any(String), content: noteContent2 },
        ],
      })

      // Sanity check that the items are actually created
      const allNotes = await context.query.Note.findMany({
        where: { id: { in: user.notes.map(({ id }) => id) } },
        query: 'id content',
      })

      expect(allNotes).toHaveLength(user.notes.length)
    })
  )

  test(
    'link & create nested from within update mutation',
    runner(async ({ context }) => {
      const noteContent = sampleOne(alphanumGenerator)
      const noteContent2 = sampleOne(alphanumGenerator)

      // Create an item to link against
      const createNote = await context.query.Note.createOne({ data: { content: noteContent } })

      // Create an item to update
      const createUser = await context.query.User.createOne({ data: { username: 'A thing' } })

      // Update the item and link the relationship field
      type T = { id: IdType; notes: { id: IdType; content: string }[] }
      const user = (await context.query.User.updateOne({
        where: { id: createUser.id },
        data: {
          username: 'A thing',
          notes: { connect: [{ id: createNote.id }], create: [{ content: noteContent2 }] },
        },
        query: 'id notes { id content }',
      })) as T

      expect(user).toMatchObject({
        id: expect.any(String),
        notes: [
          { id: createNote.id, content: noteContent },
          { id: expect.any(String), content: noteContent2 },
        ],
      })

      // Sanity check that the items are actually created
      const allNotes = await context.query.Note.findMany({
        where: { id: { in: user.notes.map(({ id }) => id) } },
        query: 'id content',
      })

      expect(allNotes).toHaveLength(user.notes.length)
    })
  )
})

describe('errors on incomplete data', () => {
  test(
    'when neither id or create data passed',
    runner(async ({ context }) => {
      // Create an item that does the linking
      const { data, errors } = await context.graphql.raw({
        query: `
              mutation {
                createUser(data: { notes: {} }) {
                  id
                }
              }`,
      })

      expect(data).toEqual({ createUser: null })
      const message =
        'Input error: You must provide at least one of "set", "connect" or "create" in to-many relationship inputs for "create" operations.'
      expectSingleRelationshipError(errors, 'createUser', 'User.notes', message)
    })
  )
})

describe('with access control', () => {
  describe('read: false on related list', () => {
    test(
      'throws when link AND create nested from within create mutation',
      runner(async ({ context }) => {
        const noteContent = sampleOne(alphanumGenerator)
        const noteContent2 = sampleOne(alphanumGenerator)

        // Create an item to link against
        const createNoteNoRead = await context.sudo().query.NoteNoRead.createOne({
          data: { content: noteContent },
        })

        // Create an item that does the linking
        const { data, errors } = await context.graphql.raw({
          query: `
                mutation {
                  createUserToNotesNoRead(data: {
                    username: "A thing",
                    notes: {
                      connect: [{ id: "${createNoteNoRead.id}" }],
                      create: [{ content: "${noteContent2}" }]
                    }
                  }) {
                    id
                  }
                }`,
        })

        expect(data).toEqual({ createUserToNotesNoRead: null })
        const message = `Access denied: You cannot connect that NoteNoRead - it may not exist`
        expectSingleRelationshipError(
          errors,
          'createUserToNotesNoRead',
          'UserToNotesNoRead.notes',
          message
        )
      })
    )

    test(
      'throws when link & create nested from within update mutation',
      runner(async ({ context }) => {
        const noteContent = sampleOne(alphanumGenerator)
        const noteContent2 = sampleOne(alphanumGenerator)

        // Create an item to link against
        const createNote = await context.sudo().query.NoteNoRead.createOne({
          data: { content: noteContent },
        })

        // Create an item to update
        const createUser = await context.query.UserToNotesNoRead.createOne({
          data: { username: 'A thing' },
        })

        // Update the item and link the relationship field
        const { data, errors } = await context.graphql.raw({
          query: `
                mutation {
                  updateUserToNotesNoRead(
                    where: { id: "${createUser.id}" }
                    data: {
                      username: "A thing",
                      notes: {
                        connect: [{ id: "${createNote.id}" }],
                        create: [{ content: "${noteContent2}" }]
                      }
                    }
                  ) {
                    id
                  }
                }`,
        })

        expect(data).toEqual({ updateUserToNotesNoRead: null })
        const message = `Access denied: You cannot connect that NoteNoRead - it may not exist`
        expectSingleRelationshipError(
          errors,
          'updateUserToNotesNoRead',
          'UserToNotesNoRead.notes',
          message
        )
      })
    )
  })
})
