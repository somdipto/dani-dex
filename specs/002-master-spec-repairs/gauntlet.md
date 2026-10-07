# Failure cases

Import: remote/missing account, account change, other agent, malformed/large input, invalid storage,
legacy automatic migration, lost response, overlapping retry, newly staged entries during completion,
full memory capacity, edited secret-like text and failed readback. No private content in evidence.
Voice: preparation throws, unavailable runtime, late preparation after cancellation, wrong cancel ID,
child failure/timeout, temporary files and microphone tracks on teardown, stale transcription completion.
Packaging: actual Linux compile and executable invocation; CI checks all three OS contracts.
Tests do not prove native speech, deployed auth, hosted cost or provider eligibility.
