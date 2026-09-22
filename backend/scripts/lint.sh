#!/usr/bin/env bash

set -e
set -x

mypy .
ruff check app
ruff format app --check
