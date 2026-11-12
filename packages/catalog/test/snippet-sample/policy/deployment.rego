package main

deny contains msg if {
	input.kind == "Deployment"
	not input.spec.template.spec.securityContext.runAsNonRoot
	msg := "containers must not run as root"
}
