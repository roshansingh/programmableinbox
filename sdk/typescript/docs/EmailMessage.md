
# EmailMessage

An email message

## Properties

Name | Type
------------ | -------------
`id` | string
`threadId` | string
`parentMessageId` | string
`subject` | string
`from` | string
`to` | Array&lt;string&gt;
`cc` | Array&lt;string&gt;
`bcc` | Array&lt;string&gt;
`text` | string
`html` | string
`bodyText` | string
`isStarred` | boolean
`isRead` | boolean
`tags` | Array&lt;string&gt;
`categories` | Array&lt;string&gt;
`extractedOtp` | string
`createdAt` | Date
`threadCount` | number

## Example

```typescript
import type { EmailMessage } from '@programmableinbox/sdk'

// TODO: Update the object below with actual values
const example = {
  "id": msg-1,
  "threadId": thread-1,
  "parentMessageId": msg-0,
  "subject": Support Request,
  "from": customer@example.com,
  "to": null,
  "cc": null,
  "bcc": null,
  "text": Hello, I need help with...,
  "html": <p>Hello, I need help with...</p>,
  "bodyText": Hello, I need help with...,
  "isStarred": false,
  "isRead": false,
  "tags": null,
  "categories": null,
  "extractedOtp": 123456,
  "createdAt": null,
  "threadCount": null,
} satisfies EmailMessage

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as EmailMessage
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


