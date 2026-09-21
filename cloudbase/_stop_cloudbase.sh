#!/usr/bin/env bash
# 停止 CloudBase 环境 cloudbase-test-d8gna6iyy14e2ba39 的全部计费资源
#   1) 删除云托管服务 aiphonix-api（计费主体）
#   2) 清空静态托管全部 7502 个文件
# 保留：prod-d4g344rzb999de5d3（空环境，无服务）
# 前置：videos / letter-clips 已备份到 _cb_backup_20260921
set -u

NODE="C:/Users/lhl20/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
TCB="C:/Users/lhl20/.workbuddy/binaries/node/cli-connector-packages/node_modules/@cloudbase/cli/bin/tcb"
ENV="cloudbase-test-d8gna6iyy14e2ba39"

echo "################ 步骤 1/2：删除云托管服务 aiphonix-api ################"
timeout 300 "$NODE" "$TCB" cloudrun delete -s aiphonix-api -e "$ENV" --force 2>&1 | tail -20
echo
echo "################ 步骤 2/2：清空静态托管 ################"
# 逐个删除顶层目录（含 7502 文件）
for d in web tts-cache letter-clips videos __auth cloud-admin; do
  echo "---- 删除 $d/ ----"
  timeout 900 "$NODE" "$TCB" hosting delete "$d" --dir -e "$ENV" 2>&1 | tail -6
done

echo
echo "################ 校验 ################"
echo "---- 云托管应为空 ----"
timeout 200 "$NODE" "$TCB" cloudrun list -e "$ENV" 2>&1 | tail -12
echo "---- 静态托管应为空 ----"
timeout 200 "$NODE" "$TCB" hosting list -e "$ENV" 2>&1 | tail -12
