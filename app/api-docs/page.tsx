'use client'

import SwaggerUI from 'swagger-ui-react'
import 'swagger-ui-react/swagger-ui.css'

export default function ApiDocsPage() {
  return (
    <div style={{ padding: '20px' }}>
      <SwaggerUI url="/api/docs" />
    </div>
  )
}
