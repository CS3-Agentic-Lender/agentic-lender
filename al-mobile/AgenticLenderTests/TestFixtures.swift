/// Values shared by the unit tests. Every password here is fake and used only in unit tests.
enum TestFixtures {
    static let password = "secret12" // betterleaks:allow — fake password, unit tests only, never real auth
    static let lettersOnlyPassword = "abcdefgh" // betterleaks:allow — fake weak password for rule tests
    static let numbersOnlyPassword = "12345678" // betterleaks:allow — fake weak password for rule tests
    static let eightCharacterPassword = "abcdefg1" // betterleaks:allow — fake password at the minimum length
}
