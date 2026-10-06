# Attack cases

Executed: absent/empty/malformed/duplicate manifest, traversal filename, wrong architecture,
uppercase hash and GNU marker, corrupt/incomplete download, copy failure, activation failure,
restoration failure, concurrent lock, app-directory replacement and simulated Windows process failure.
Tests assert installed bytes, owner-data preservation, request scope and cleanup.
Node/Linux behavior runs through real subprocesses and a loopback server using synthetic artifacts.
Simulated Windows process failure is not Windows installer acceptance.
Mac directory-copy tests are not physical Mac acceptance. No audio/pixel/live provider proof exists.
Review was performed by the implementing agent; an independent critic and native owner review remain pending.
