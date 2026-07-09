# Idea Environments

Top-level overview of the deployed full-stack environment. Sakura Bloom is the one and only design;
the design variants were removed on 2026-07-04 (see [ADR-008](docs/adr/008-remove-design-variants.md)).

## Registry
<!-- IDEA_REGISTRY_START -->
- idea=dev | stack=StaticWebAWSAIStack-dev | status=LIVE | last_action=2026-07-09T21:24:40.991Z | cloudfront=https://d2l9b1xmucsb19.cloudfront.net | api=https://k002t5i8r9.execute-api.us-east-1.amazonaws.com/prod/ | folder=ideas/dev | note=Deployed 6ac36ff
<!-- IDEA_REGISTRY_END -->

## Operating Rules
- The single idea (`dev`) keeps its folder `ideas/dev/` with `README.md`, `DECISIONS.md`, `RUNBOOK.md`, `STATUS.md`, and `IMPROVEMENTS.md`.
- Deploy and destroy actions should be run via the CDK helper commands so this registry and the idea status log stay in sync.

## Standard Commands
- `npm --prefix cdk run idea:list`
- `npm --prefix cdk run idea:deploy -- --stage=dev [--owner="<owner>"] [--ttl-days=<days>]`
- `npm --prefix cdk run idea:seed -- --target-stage=dev [--source-stage=<source-stage>] [--source-stack=<stack-name>] [--seed-user-email=<email>] [--seed-user-password=<password>]`
- `npm --prefix cdk run idea:destroy -- --stage=dev`
- `npm --prefix cdk run idea:diff -- --stage=dev`
- `npm --prefix cdk run idea:synth -- --stage=dev`
