describe('@programmableinbox/testing under real Cypress', () => {
  it('cy.pibxOtp reads server time, runs after(), and yields the code', () => {
    let afterRan = false
    cy.pibxOtp({
      from: 'openai.com',
      timeoutMs: 5000,
      pollIntervalMs: 50,
      after: () => {
        cy.then(() => { afterRan = true })
      },
    })
      .should('equal', '314159')
      .then(() => expect(afterRan).to.equal(true))
  })

  it('the low-level pair works too', () => {
    cy.pibxNow().then((since) => {
      expect(Date.parse(since)).to.not.be.NaN
      cy.pibxWaitForOtp({ since, timeoutMs: 5000, pollIntervalMs: 50 }).should('equal', '314159')
    })
  })
})
