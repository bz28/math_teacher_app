FROM python:3.12-slim AS base

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY pyproject.toml constraints.txt ./
# First install pulls dependencies declared in pyproject — fast and cacheable.
# `-c constraints.txt` pins every direct dependency so a production image
# built today and one built in six months resolve the same versions. Without
# it, pyproject's lower bounds mean an upstream release lands in prod on the
# next deploy, unreviewed.
RUN uv pip install --system -e . -c constraints.txt

COPY . .

# Re-run the editable install now that the api/ source is present. The
# previous install ran with only pyproject.toml on disk, so setuptools'
# packages.find discovered no packages and wrote an empty MAPPING into
# the editable finder. Without this step `import api` fails at runtime.
RUN uv pip install --system -e . -c constraints.txt

# Create and switch to non-root user. A container escape from a root
# process inherits root on the host kernel namespace; running as an
# unprivileged UID/GID limits the blast radius. Chown /app so the
# runtime can still read source and write alembic state.
RUN groupadd --system --gid 1000 app \
 && useradd --system --uid 1000 --gid 1000 --no-create-home app \
 && chown -R app:app /app
USER app:app

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && uvicorn api.main:app --host 0.0.0.0 --port 8000"]
